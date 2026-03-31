"""Tensor-equality tests for all 19 rewrite rules and simplification strategies.

Uses pyzx.graph.multigraph.Multigraph to match the Pyodide worker's graph backend.
Requires PyZX git HEAD (not PyPI 0.9.0).
"""

import json
import unittest
from fractions import Fraction

import pyzx as zx
from pyzx.graph.multigraph import Multigraph
from pyzx.utils import EdgeType, VertexType
from pyzx.rewrite_rules.fuse_rule import unfuse as _unfuse


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_graph():
    """Create a fresh multigraph with auto_simplify off (matches worker)."""
    g = Multigraph()
    g.set_auto_simplify(False)
    return g


def toggle_vertex(vt):
    return VertexType.X if vt == VertexType.Z else VertexType.Z


def _upair(a, b):
    return (a, b) if a < b else (b, a)


def _remove_one_edge(g, e):
    """Remove a single edge from a multigraph."""
    s, t, et = e
    for edge in list(g.edges(s, t)):
        if edge[2] == et:
            g.remove_edge(edge)
            return


# ---------------------------------------------------------------------------
# Custom rule implementations (mirroring pyodide-worker.mjs)
# ---------------------------------------------------------------------------

def apply_gadgetize(g, v):
    """Extract phase from spider v into a degree-1 leaf via SIMPLE edge."""
    phase = g.phase(v)
    g.set_phase(v, Fraction(0))
    new_v = g.add_vertex(g.type(v))
    g.set_row(new_v, g.row(v) + 1.0)
    g.set_qubit(new_v, g.qubit(v) + 0.5)
    g.set_phase(new_v, phase)
    g.add_edge((v, new_v), edgetype=EdgeType.SIMPLE)


def apply_wire_vertex(g, s, t):
    """Insert a phaseless Z-spider on one edge between s and t."""
    edge = None
    for e in g.edges(s, t):
        edge = e
        break
    if edge is None:
        return
    et = edge[2]
    _remove_one_edge(g, edge)
    mid = g.add_vertex(VertexType.Z)
    g.set_row(mid, 0.5 * (g.row(s) + g.row(t)))
    g.set_qubit(mid, 0.5 * (g.qubit(s) + g.qubit(t)))
    g.add_edge((s, mid), edgetype=et)
    g.add_edge((mid, t), edgetype=EdgeType.SIMPLE)


def apply_hopf(g, s, t):
    """Remove parallel edges in pairs (Hopf rule)."""
    st = g.type(s)
    tt = g.type(t)
    same_color = (st == tt)
    target_type = EdgeType.HADAMARD if same_color else EdgeType.SIMPLE
    target_edges = [e for e in g.edges(s, t) if e[2] == target_type]
    pairs_to_remove = (len(target_edges) // 2) * 2
    for i in range(pairs_to_remove):
        _remove_one_edge(g, target_edges[i])
    g.scalar.add_power(-pairs_to_remove)


def apply_self_loop_removal(g, v):
    """Remove self-loops on vertex v, absorbing Hadamard loops as +pi phase."""
    for e in list(g.edges(v, v)):
        if e[2] == EdgeType.HADAMARD:
            g.add_to_phase(v, Fraction(1))
        _remove_one_edge(g, e)


def apply_euler_decomp(g, s, t):
    """Replace one Hadamard edge between s and t with Euler decomposition."""
    types = g.types()
    phases = g.phases()

    had_edge = None
    for e in list(g.edges(s, t)):
        if e[2] == EdgeType.HADAMARD:
            had_edge = e
            break
    if had_edge is None:
        return

    st = types[s]
    tt = types[t]
    if st in (VertexType.Z, VertexType.X) and st == tt:
        r = 0.5 * (g.row(s) + g.row(t))
        q = 0.5 * (g.qubit(s) + g.qubit(t))
        mid = g.add_vertex(toggle_vertex(st), q, r)
        g.add_edge((mid, s), edgetype=EdgeType.SIMPLE)
        g.add_edge((mid, t), edgetype=EdgeType.SIMPLE)
        if phases[s] == Fraction(1, 2) or phases[t] == Fraction(1, 2):
            g.add_to_phase(s, Fraction(3, 2))
            g.add_to_phase(t, Fraction(3, 2))
            g.set_phase(mid, Fraction(3, 2))
            g.scalar.add_phase(Fraction(1, 4))
        else:
            g.add_to_phase(s, Fraction(1, 2))
            g.add_to_phase(t, Fraction(1, 2))
            g.set_phase(mid, Fraction(1, 2))
            g.scalar.add_phase(Fraction(7, 4))
    else:
        sr, sq = g.row(s), g.qubit(s)
        tr, tq = g.row(t), g.qubit(t)
        z1 = g.add_vertex(VertexType.Z, sq + (tq - sq) * 0.25,
                          sr + (tr - sr) * 0.25, Fraction(1, 2))
        x1 = g.add_vertex(VertexType.X, sq + (tq - sq) * 0.50,
                          sr + (tr - sr) * 0.50, Fraction(1, 2))
        z2 = g.add_vertex(VertexType.Z, sq + (tq - sq) * 0.75,
                          sr + (tr - sr) * 0.75, Fraction(1, 2))
        g.add_edge((t, z1), edgetype=EdgeType.SIMPLE)
        g.add_edge((z1, x1), edgetype=EdgeType.SIMPLE)
        g.add_edge((x1, z2), edgetype=EdgeType.SIMPLE)
        g.add_edge((z2, s), edgetype=EdgeType.SIMPLE)
        g.scalar.add_phase(Fraction(7, 4))

    _remove_one_edge(g, had_edge)


def apply_unspider(g, v):
    """Split spider v: move all neighbors to a new vertex connected via SIMPLE edge.
    This is the inverse of spider fusion (called 'unspider' in PyZX PyPI 0.9.0's rules.py).
    The git HEAD doesn't have rules.unspider, so we implement it here."""
    vt = g.type(v)
    phase = g.phase(v)
    neighbors = list(g.neighbors(v))
    # Create new vertex with original phase; clear v's phase
    nv = g.add_vertex(vt)
    g.set_row(nv, g.row(v) + 0.5)
    g.set_qubit(nv, g.qubit(v) + 0.5)
    g.set_phase(nv, phase)
    g.set_phase(v, Fraction(0))
    # Move all edges from v->neighbors to nv->neighbors
    for n in neighbors:
        for e in list(g.edges(v, n)):
            et = e[2]
            g.remove_edge(e)
            g.add_edge((nv, n), edgetype=et)
    # Connect v and nv with simple edge
    g.add_edge((v, nv), edgetype=EdgeType.SIMPLE)


def apply_push_pauli(g, v, n):
    """Push pi-phase spider v through neighbor n."""
    etab = {}
    rem_verts = []
    rem_edges = []

    vp = g.phase(v)

    if g.vertex_degree(v) == 2:
        rem_verts.append(v)
        l = list(g.neighbors(v))
        l.remove(n)
        v2 = l[0]
        et1 = g.edge_type(g.edge(n, v))
        et2 = g.edge_type(g.edge(v2, v))
        etab[_upair(n, v2)] = [1, 0] if et1 == et2 else [0, 1]
    else:
        g.set_phase(v, Fraction(0))

    g.scalar.add_phase(g.phase(n))
    g.set_phase(n, ((1 - 2 * vp) * g.phase(n)) % 2)

    toggled = toggle_vertex(g.type(n))
    for edge in list(g.incident_edges(n)):
        st = g.edge_st(edge)
        w = st[0] if st[1] == n else st[1]
        if w == v:
            continue
        r = 0.5 * (g.row(n) + g.row(w))
        q = 0.5 * (g.qubit(n) + g.qubit(w))
        et = g.edge_type(edge)
        rem_edges.append(edge)
        w2 = g.add_vertex(toggled, q, r, vp)
        etab[_upair(n, w2)] = [1, 0]
        etab[_upair(w, w2)] = [1, 0] if et == EdgeType.SIMPLE else [0, 1]

    g.add_edge_table(etab)
    g.remove_vertices(rem_verts)
    g.remove_edges(rem_edges)


# ---------------------------------------------------------------------------
# Test Cases
# ---------------------------------------------------------------------------

class TestGadgetize(unittest.TestCase):
    """Gadgetize must preserve tensor (SIMPLE edge, NOT Hadamard)."""

    def test_z_spider_2_legs(self):
        """Z(pi/4) with input + output."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_gadgetize(g2, 1)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=True))

    def test_z_spider_3_legs(self):
        """Z(7pi/4) with 2 inputs + 1 output (arity 3)."""
        g = make_graph()
        b1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0.5, row=1, phase=Fraction(7, 4))
        b3 = g.add_vertex(VertexType.BOUNDARY, qubit=0.5, row=2)
        g.add_edge((b1, z), EdgeType.SIMPLE)
        g.add_edge((b2, z), EdgeType.SIMPLE)
        g.add_edge((z, b3), EdgeType.SIMPLE)
        g.set_inputs([b1, b2])
        g.set_outputs([b3])

        g2 = g.copy()
        apply_gadgetize(g2, 2)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_x_spider(self):
        """X(pi/3) spider (non-Clifford X)."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        x = g.add_vertex(VertexType.X, qubit=0, row=1, phase=Fraction(1, 3))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((b_in, x), EdgeType.SIMPLE)
        g.add_edge((x, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_gadgetize(g2, 1)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_hadamard_edge_is_wrong(self):
        """NEGATIVE TEST: Hadamard-connected gadget must NOT preserve tensor."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g_bad = g.copy()
        phase = g_bad.phase(1)
        g_bad.set_phase(1, Fraction(0))
        new_v = g_bad.add_vertex(VertexType.Z, qubit=0.5, row=1.5, phase=phase)
        g_bad.add_edge((1, new_v), EdgeType.HADAMARD)

        self.assertFalse(zx.compare_tensors(g, g_bad, preserve_scalar=False),
                         "Hadamard gadget should NOT be tensor-equivalent!")


class TestWireVertex(unittest.TestCase):
    """Wire vertex (insert identity spider on edge) must preserve tensor."""

    def test_simple_edge(self):
        """Insert identity on a simple edge."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 2))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_wire_vertex(g2, 0, 1)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_hadamard_edge(self):
        """Insert identity on a Hadamard edge."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_wire_vertex(g2, 1, 2)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_between_boundaries(self):
        """Insert identity on an edge between two boundaries (wire)."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((b_in, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_wire_vertex(g2, 0, 1)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestHopf(unittest.TestCase):
    """Hopf rule (parallel edge cancellation) must preserve tensor."""

    def test_same_color_hadamard_pair(self):
        """Two Z spiders with 2 Hadamard edges -> cancel to 0 edges."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_hopf(g2, 1, 2)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_different_color_simple_pair(self):
        """Z and X spiders with 2 simple edges -> cancel to 0 edges."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1)
        x = g.add_vertex(VertexType.X, qubit=0, row=2)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, x), EdgeType.SIMPLE)
        g.add_edge((z, x), EdgeType.SIMPLE)
        g.add_edge((x, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_hopf(g2, 1, 2)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_three_parallel_keeps_one(self):
        """3 Hadamard edges between same-color -> remove 2, keep 1."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_hopf(g2, 1, 2)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestSelfLoopRemoval(unittest.TestCase):
    """Self-loop removal must preserve tensor (Hadamard loop = +pi phase)."""

    def test_hadamard_self_loop(self):
        """Z spider with Hadamard self-loop -> absorb as +pi."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, z), EdgeType.HADAMARD)
        g.add_edge((z, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_self_loop_removal(g2, 1)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_simple_self_loop(self):
        """Z spider with simple self-loop -> remove (scalar only, no phase change)."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 2))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, z), EdgeType.SIMPLE)
        g.add_edge((z, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_self_loop_removal(g2, 1)

        # Simple self-loops only change scalar (which our impl doesn't track),
        # so check without scalar preservation
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestEulerDecomposition(unittest.TestCase):
    """Euler decomposition (Hadamard -> spider chain) must preserve tensor."""

    def test_same_color_z_general(self):
        """H edge between two Z spiders (general phase case)."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2, phase=Fraction(3, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_euler_decomp(g2, 1, 2)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_same_color_z_pi2_case(self):
        """H edge between two Z spiders (one has pi/2 phase -> special case)."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 2))
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_euler_decomp(g2, 1, 2)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_different_color_general(self):
        """H edge between Z and X spider (general case -> Z-X-Z chain)."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        x = g.add_vertex(VertexType.X, qubit=0, row=2, phase=Fraction(3, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, x), EdgeType.HADAMARD)
        g.add_edge((x, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_euler_decomp(g2, 1, 2)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_boundary_to_z(self):
        """H edge between boundary and Z spider (general case)."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((b_in, z), EdgeType.HADAMARD)
        g.add_edge((z, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_euler_decomp(g2, 0, 1)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_2_qubit(self):
        """H edge between Z spiders in a 2-qubit diagram."""
        g = make_graph()
        b_in1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b_in2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=1, row=1)
        b_out1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        b_out2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=2)
        g.add_edge((b_in1, z1), EdgeType.SIMPLE)
        g.add_edge((b_in2, z2), EdgeType.SIMPLE)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z1, b_out1), EdgeType.SIMPLE)
        g.add_edge((z2, b_out2), EdgeType.SIMPLE)
        g.set_inputs([b_in1, b_in2])
        g.set_outputs([b_out1, b_out2])

        g2 = g.copy()
        apply_euler_decomp(g2, 2, 3)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestPushPauli(unittest.TestCase):
    """Push Pauli (pi-commutation) must preserve tensor."""

    def test_z_pi_through_z(self):
        """Push Z(pi) through a neighboring Z spider via Hadamard edge."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z_pi = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1))
        z_target = g.add_vertex(VertexType.Z, qubit=0, row=2, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z_pi), EdgeType.SIMPLE)
        g.add_edge((z_pi, z_target), EdgeType.HADAMARD)
        g.add_edge((z_target, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_push_pauli(g2, 1, 2)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_z_pi_through_x_simple(self):
        """Push Z(pi) through X spider via simple edge."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z_pi = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1))
        x_target = g.add_vertex(VertexType.X, qubit=0, row=2, phase=Fraction(1, 2))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z_pi), EdgeType.SIMPLE)
        g.add_edge((z_pi, x_target), EdgeType.SIMPLE)
        g.add_edge((x_target, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_push_pauli(g2, 1, 2)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_push_through_3_leg_spider(self):
        """Push Z(pi) through a 3-leg Z spider (creates copies at other neighbors)."""
        g = make_graph()
        b_in1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b_in2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z_pi = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1))
        z_target = g.add_vertex(VertexType.Z, qubit=0.5, row=2, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0.5, row=3)
        g.add_edge((b_in1, z_pi), EdgeType.SIMPLE)
        g.add_edge((z_pi, z_target), EdgeType.HADAMARD)
        g.add_edge((b_in2, z_target), EdgeType.SIMPLE)
        g.add_edge((z_target, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in1, b_in2])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_push_pauli(g2, 2, 3)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestCopyRule(unittest.TestCase):
    """Copy rule (bialgebra on degree-1 spider) must preserve tensor.
    Delegates to PyZX's bialgebra/strong_comp."""

    def test_phaseless_z_degree_1(self):
        """Phaseless Z degree-1 spider copied through phaseless X neighbor."""
        g = make_graph()
        b_in1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b_in2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z_copy = g.add_vertex(VertexType.Z, qubit=-0.5, row=1)
        x_target = g.add_vertex(VertexType.X, qubit=0.5, row=1)
        b_out1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        b_out2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=2)
        g.add_edge((b_in1, x_target), EdgeType.SIMPLE)
        g.add_edge((b_in2, x_target), EdgeType.SIMPLE)
        g.add_edge((z_copy, x_target), EdgeType.SIMPLE)
        g.add_edge((x_target, b_out1), EdgeType.SIMPLE)
        g.add_edge((x_target, b_out2), EdgeType.SIMPLE)
        g.set_inputs([b_in1, b_in2])
        g.set_outputs([b_out1, b_out2])

        g2 = g.copy()
        # Use PyZX's bialgebra (check_bialgebra + bialgebra), matching the worker
        self.assertTrue(zx.check_bialgebra(g2, 2, 3))
        zx.unsafe_bialgebra(g2, 2, 3)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


# ---------------------------------------------------------------------------
# PyZX-delegated rules (Part 1A — 12 previously untested rules)
# ---------------------------------------------------------------------------

class TestSpiderFusionPyZX(unittest.TestCase):
    """Spider fusion via PyZX (check_fuse/unsafe_fuse) must preserve tensor.
    Note: check_fuse only allows fusion via simple connecting edges."""

    def test_z_plus_z_simple(self):
        """Z(0) + Z(pi/4) via simple edge."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z2), EdgeType.SIMPLE)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        self.assertTrue(zx.check_fuse(g, z1, z2))
        g2 = g.copy()
        zx.unsafe_fuse(g2, z1, z2)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_x_plus_x_simple(self):
        """X(pi/2) + X(pi/4) via simple edge."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        x1 = g.add_vertex(VertexType.X, qubit=0, row=1, phase=Fraction(1, 2))
        x2 = g.add_vertex(VertexType.X, qubit=0, row=2, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, x1), EdgeType.SIMPLE)
        g.add_edge((x1, x2), EdgeType.SIMPLE)
        g.add_edge((x2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        zx.unsafe_fuse(g2, x1, x2)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_phased_sum(self):
        """Z(pi/4) + Z(pi/2) → Z(3pi/4): phases add correctly."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2, phase=Fraction(1, 2))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z2), EdgeType.SIMPLE)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        zx.unsafe_fuse(g2, z1, z2)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_check_fuse_rejects_hadamard_only(self):
        """check_fuse must return False for Hadamard-only connections."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        self.assertFalse(zx.check_fuse(g, z1, z2),
                         "check_fuse should reject H-only same-color connections")

    def test_2_qubit_fuse(self):
        """Fuse two Z spiders in a 2-qubit diagram."""
        g = make_graph()
        b_in1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b_in2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        z2 = g.add_vertex(VertexType.Z, qubit=0.5, row=2)
        b_out1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        b_out2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=3)
        g.add_edge((b_in1, z1), EdgeType.SIMPLE)
        g.add_edge((b_in2, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z2), EdgeType.SIMPLE)
        g.add_edge((z2, b_out1), EdgeType.SIMPLE)
        g.add_edge((z2, b_out2), EdgeType.SIMPLE)
        g.set_inputs([b_in1, b_in2])
        g.set_outputs([b_out1, b_out2])

        g2 = g.copy()
        zx.unsafe_fuse(g2, z1, z2)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestIdRemoval(unittest.TestCase):
    """ID removal (check_remove_id/unsafe_remove_id) must preserve tensor."""

    def test_simple_edges(self):
        """Phaseless Z degree-2 between two nodes, both simple edges."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        z_id = g.add_vertex(VertexType.Z, qubit=0, row=2)  # phaseless degree-2
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=3, phase=Fraction(1, 2))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=4)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z_id), EdgeType.SIMPLE)
        g.add_edge((z_id, z2), EdgeType.SIMPLE)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        self.assertTrue(zx.check_remove_id(g, z_id))
        g2 = g.copy()
        zx.unsafe_remove_id(g2, z_id)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_hadamard_both_sides(self):
        """Phaseless Z degree-2 with Hadamard edges both sides."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z_id = g.add_vertex(VertexType.Z, qubit=0, row=2)
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=3)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=4)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z_id), EdgeType.HADAMARD)
        g.add_edge((z_id, z2), EdgeType.HADAMARD)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        self.assertTrue(zx.check_remove_id(g, z_id))
        g2 = g.copy()
        zx.unsafe_remove_id(g2, z_id)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_mixed_edges(self):
        """Phaseless Z degree-2 with one simple, one Hadamard edge."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z_id = g.add_vertex(VertexType.Z, qubit=0, row=2)
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=3)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=4)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z_id), EdgeType.SIMPLE)
        g.add_edge((z_id, z2), EdgeType.HADAMARD)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        self.assertTrue(zx.check_remove_id(g, z_id))
        g2 = g.copy()
        zx.unsafe_remove_id(g2, z_id)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestBialgebra(unittest.TestCase):
    """Bialgebra / strong complementarity (check_bialgebra/unsafe_bialgebra)."""

    def test_z_x_simple(self):
        """Z connected to X via simple edge."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1)
        x = g.add_vertex(VertexType.X, qubit=0, row=2)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, x), EdgeType.SIMPLE)
        g.add_edge((x, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        self.assertTrue(zx.check_bialgebra(g, z, x))
        g2 = g.copy()
        zx.unsafe_bialgebra(g2, z, x)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_z_x_hadamard_rejected(self):
        """check_bialgebra requires simple edge — Hadamard edge rejected."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1)
        x = g.add_vertex(VertexType.X, qubit=0, row=2)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, x), EdgeType.HADAMARD)
        g.add_edge((x, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        # check_bialgebra requires a simple edge between Z and X
        self.assertFalse(zx.check_bialgebra(g, z, x))

    def test_2_qubit_z_x(self):
        """2-qubit bialgebra: Z with 2 inputs, X with 2 outputs."""
        g = make_graph()
        b_in1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b_in2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0.5, row=1)
        x = g.add_vertex(VertexType.X, qubit=0.5, row=2)
        b_out1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        b_out2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=3)
        g.add_edge((b_in1, z), EdgeType.SIMPLE)
        g.add_edge((b_in2, z), EdgeType.SIMPLE)
        g.add_edge((z, x), EdgeType.SIMPLE)
        g.add_edge((x, b_out1), EdgeType.SIMPLE)
        g.add_edge((x, b_out2), EdgeType.SIMPLE)
        g.set_inputs([b_in1, b_in2])
        g.set_outputs([b_out1, b_out2])

        g2 = g.copy()
        zx.unsafe_bialgebra(g2, z, x)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestBialgebraReverse(unittest.TestCase):
    """Reverse bialgebra (is_bialg_op_match/safe_apply_bialgebra_op)."""

    def test_k22_simple(self):
        """2Z + 2X complete bipartite via simple edges → compress."""
        g = make_graph()
        bi1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        bi2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=1, row=1)
        x1 = g.add_vertex(VertexType.X, qubit=0, row=2)
        x2 = g.add_vertex(VertexType.X, qubit=1, row=2)
        bo1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        bo2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=3)
        g.add_edge((bi1, z1), EdgeType.SIMPLE)
        g.add_edge((bi2, z2), EdgeType.SIMPLE)
        g.add_edge((z1, x1), EdgeType.SIMPLE)
        g.add_edge((z1, x2), EdgeType.SIMPLE)
        g.add_edge((z2, x1), EdgeType.SIMPLE)
        g.add_edge((z2, x2), EdgeType.SIMPLE)
        g.add_edge((x1, bo1), EdgeType.SIMPLE)
        g.add_edge((x2, bo2), EdgeType.SIMPLE)
        g.set_inputs([bi1, bi2])
        g.set_outputs([bo1, bo2])

        self.assertTrue(zx.is_bialg_op_match(g, [z1, z2, x1, x2]))
        g2 = g.copy()
        result = zx.safe_apply_bialgebra_op(g2, [z1, z2, x1, x2])
        self.assertTrue(result)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_round_trip(self):
        """Bialgebra forward then reverse recovers tensor."""
        g = make_graph()
        bi1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        bi2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0.5, row=1)
        x = g.add_vertex(VertexType.X, qubit=0.5, row=2)
        bo1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        bo2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=3)
        g.add_edge((bi1, z), EdgeType.SIMPLE)
        g.add_edge((bi2, z), EdgeType.SIMPLE)
        g.add_edge((z, x), EdgeType.SIMPLE)
        g.add_edge((x, bo1), EdgeType.SIMPLE)
        g.add_edge((x, bo2), EdgeType.SIMPLE)
        g.set_inputs([bi1, bi2])
        g.set_outputs([bo1, bo2])
        g_orig = g.copy()

        # Forward bialgebra
        zx.unsafe_bialgebra(g, z, x)
        self.assertTrue(zx.compare_tensors(g_orig, g, preserve_scalar=False),
                        "Forward bialgebra should preserve tensor")

        # Now reverse: find all Z and X in the result
        z_verts = [v for v in g.vertices() if g.type(v) == VertexType.Z]
        x_verts = [v for v in g.vertices() if g.type(v) == VertexType.X]
        all_verts = z_verts + x_verts
        if zx.is_bialg_op_match(g, all_verts):
            zx.safe_apply_bialgebra_op(g, all_verts)
            self.assertTrue(zx.compare_tensors(g_orig, g, preserve_scalar=False),
                            "Round-trip should preserve tensor")


class TestColorChange(unittest.TestCase):
    """Color change (check_color_change/unsafe_color_change)."""

    def test_z_to_x(self):
        """Z spider → X spider (all edges flip type)."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        zx.unsafe_color_change(g2, z)
        self.assertEqual(g2.type(z), VertexType.X)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_x_to_z(self):
        """X spider → Z spider."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        x = g.add_vertex(VertexType.X, qubit=0, row=1, phase=Fraction(1, 2))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((b_in, x), EdgeType.SIMPLE)
        g.add_edge((x, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        zx.unsafe_color_change(g2, x)
        self.assertEqual(g2.type(x), VertexType.Z)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_3_leg_z(self):
        """Color change on 3-leg Z spider with mixed edge types."""
        g = make_graph()
        b_in1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b_in2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0.5, row=1, phase=Fraction(3, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0.5, row=2)
        g.add_edge((b_in1, z), EdgeType.SIMPLE)
        g.add_edge((b_in2, z), EdgeType.HADAMARD)
        g.add_edge((z, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in1, b_in2])
        g.set_outputs([b_out])

        g2 = g.copy()
        zx.unsafe_color_change(g2, z)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestUnfuse(unittest.TestCase):
    """Unfuse (split spider) must preserve tensor."""

    def test_z_non_clifford(self):
        """Split non-Clifford Z spider into phaseless + phased."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_unspider(g2, z)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_x_non_clifford(self):
        """Split non-Clifford X spider."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        x = g.add_vertex(VertexType.X, qubit=0, row=1, phase=Fraction(1, 3))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((b_in, x), EdgeType.SIMPLE)
        g.add_edge((x, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_unspider(g2, x)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_3_leg_z(self):
        """Split 3-leg non-Clifford Z spider."""
        g = make_graph()
        b_in1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b_in2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0.5, row=1, phase=Fraction(7, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0.5, row=2)
        g.add_edge((b_in1, z), EdgeType.SIMPLE)
        g.add_edge((b_in2, z), EdgeType.SIMPLE)
        g.add_edge((z, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in1, b_in2])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_unspider(g2, z)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_unfuse_with_phase_split(self):
        """Unfuse with explicit phase: new spider gets m[2], original keeps remainder."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0.5, row=1, phase=Fraction(3, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=2)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        # Split: new gets pi/4, original keeps pi/2
        _unfuse(g2, [z, [b_out], Fraction(1, 4)])
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_unfuse_with_zero_phase(self):
        """Unfuse with explicit phase=0: new spider gets 0, original keeps all phase."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0.5, row=1, phase=Fraction(1, 2))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=2)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        _unfuse(g2, [z, [b_out], Fraction(0)])
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_unfuse_via_worker_with_phase(self):
        """Round-trip test via worker_functions with unfuse_phase_json."""
        from worker_functions import zxs_apply_rewrite
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0.5, row=1, phase=Fraction(3, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=2)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g_json = g.to_json()
        # match = [z, b_out] → vertex z, neighbors = [b_out]
        match_json = json.dumps([z, b_out])
        phase_json = json.dumps({"n": 1, "d": 4})
        result_json = zxs_apply_rewrite(g_json, 'unfuse', match_json, phase_json)
        g2 = zx.Graph.from_json(result_json)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestLComp(unittest.TestCase):
    """Local complementation (check_lcomp/unsafe_lcomp)."""

    def test_2_neighbors(self):
        """Z(pi/2) with 2 Hadamard-connected Z neighbors."""
        g = make_graph()
        b_in1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b_in2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=1, row=1)
        z_center = g.add_vertex(VertexType.Z, qubit=0.5, row=2, phase=Fraction(1, 2))
        b_out1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        b_out2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=3)
        g.add_edge((b_in1, z1), EdgeType.SIMPLE)
        g.add_edge((b_in2, z2), EdgeType.SIMPLE)
        g.add_edge((z1, z_center), EdgeType.HADAMARD)
        g.add_edge((z2, z_center), EdgeType.HADAMARD)
        g.add_edge((z1, b_out1), EdgeType.SIMPLE)
        g.add_edge((z2, b_out2), EdgeType.SIMPLE)
        g.set_inputs([b_in1, b_in2])
        g.set_outputs([b_out1, b_out2])

        self.assertTrue(zx.check_lcomp(g, z_center))
        g2 = g.copy()
        zx.unsafe_lcomp(g2, z_center)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_3_neighbors(self):
        """Z(pi/2) with 3 Hadamard-connected Z neighbors (complementation)."""
        g = make_graph()
        bi1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        bi2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        bi3 = g.add_vertex(VertexType.BOUNDARY, qubit=2, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=1, row=1)
        z3 = g.add_vertex(VertexType.Z, qubit=2, row=1)
        z_c = g.add_vertex(VertexType.Z, qubit=1, row=2, phase=Fraction(1, 2))
        bo1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        bo2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=3)
        bo3 = g.add_vertex(VertexType.BOUNDARY, qubit=2, row=3)
        g.add_edge((bi1, z1), EdgeType.SIMPLE)
        g.add_edge((bi2, z2), EdgeType.SIMPLE)
        g.add_edge((bi3, z3), EdgeType.SIMPLE)
        g.add_edge((z1, z_c), EdgeType.HADAMARD)
        g.add_edge((z2, z_c), EdgeType.HADAMARD)
        g.add_edge((z3, z_c), EdgeType.HADAMARD)
        g.add_edge((z1, bo1), EdgeType.SIMPLE)
        g.add_edge((z2, bo2), EdgeType.SIMPLE)
        g.add_edge((z3, bo3), EdgeType.SIMPLE)
        g.set_inputs([bi1, bi2, bi3])
        g.set_outputs([bo1, bo2, bo3])

        self.assertTrue(zx.check_lcomp(g, z_c))
        g2 = g.copy()
        zx.unsafe_lcomp(g2, z_c)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_3pi2_phase(self):
        """Z(3pi/2) — the other valid lcomp phase."""
        g = make_graph()
        bi1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        bi2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=1, row=1)
        z_c = g.add_vertex(VertexType.Z, qubit=0.5, row=2, phase=Fraction(3, 2))
        bo1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        bo2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=3)
        g.add_edge((bi1, z1), EdgeType.SIMPLE)
        g.add_edge((bi2, z2), EdgeType.SIMPLE)
        g.add_edge((z1, z_c), EdgeType.HADAMARD)
        g.add_edge((z2, z_c), EdgeType.HADAMARD)
        g.add_edge((z1, bo1), EdgeType.SIMPLE)
        g.add_edge((z2, bo2), EdgeType.SIMPLE)
        g.set_inputs([bi1, bi2])
        g.set_outputs([bo1, bo2])

        self.assertTrue(zx.check_lcomp(g, z_c))
        g2 = g.copy()
        zx.unsafe_lcomp(g2, z_c)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestPivot(unittest.TestCase):
    """Pivot (check_pivot/unsafe_pivot) — interior Clifford pair."""

    def test_basic_2_qubit(self):
        """Two interior Z(0) spiders connected by H, each with 2 H neighbors."""
        g = make_graph()
        bi1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        bi2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z3 = g.add_vertex(VertexType.Z, qubit=1, row=1)
        z_c = g.add_vertex(VertexType.Z, qubit=0, row=2)
        z_d = g.add_vertex(VertexType.Z, qubit=1, row=2)
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=3)
        z4 = g.add_vertex(VertexType.Z, qubit=1, row=3)
        bo1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=4)
        bo2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=4)
        g.add_edge((bi1, z1), EdgeType.SIMPLE)
        g.add_edge((bi2, z3), EdgeType.SIMPLE)
        g.add_edge((z1, z_c), EdgeType.HADAMARD)
        g.add_edge((z3, z_c), EdgeType.HADAMARD)
        g.add_edge((z_c, z_d), EdgeType.HADAMARD)
        g.add_edge((z_d, z2), EdgeType.HADAMARD)
        g.add_edge((z_d, z4), EdgeType.HADAMARD)
        g.add_edge((z2, bo1), EdgeType.SIMPLE)
        g.add_edge((z4, bo2), EdgeType.SIMPLE)
        g.set_inputs([bi1, bi2])
        g.set_outputs([bo1, bo2])

        self.assertTrue(zx.check_pivot(g, z_c, z_d))
        g2 = g.copy()
        zx.unsafe_pivot(g2, z_c, z_d)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_pi_phase_pair(self):
        """Two interior Z(pi) spiders — Pauli phase pivot."""
        g = make_graph()
        bi1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        bi2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z3 = g.add_vertex(VertexType.Z, qubit=1, row=1)
        z_c = g.add_vertex(VertexType.Z, qubit=0, row=2, phase=Fraction(1))
        z_d = g.add_vertex(VertexType.Z, qubit=1, row=2, phase=Fraction(1))
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=3)
        z4 = g.add_vertex(VertexType.Z, qubit=1, row=3)
        bo1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=4)
        bo2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=4)
        g.add_edge((bi1, z1), EdgeType.SIMPLE)
        g.add_edge((bi2, z3), EdgeType.SIMPLE)
        g.add_edge((z1, z_c), EdgeType.HADAMARD)
        g.add_edge((z3, z_c), EdgeType.HADAMARD)
        g.add_edge((z_c, z_d), EdgeType.HADAMARD)
        g.add_edge((z_d, z2), EdgeType.HADAMARD)
        g.add_edge((z_d, z4), EdgeType.HADAMARD)
        g.add_edge((z2, bo1), EdgeType.SIMPLE)
        g.add_edge((z4, bo2), EdgeType.SIMPLE)
        g.set_inputs([bi1, bi2])
        g.set_outputs([bo1, bo2])

        self.assertTrue(zx.check_pivot(g, z_c, z_d))
        g2 = g.copy()
        zx.unsafe_pivot(g2, z_c, z_d)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestPivotBoundary(unittest.TestCase):
    """Pivot boundary (pivot_boundary_for_apply) — pivot pair with boundary neighbor."""

    def test_one_boundary_neighbor(self):
        """Pivot pair where one spider has a boundary neighbor."""
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z_a = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z_b = g.add_vertex(VertexType.Z, qubit=0, row=2)
        z_c = g.add_vertex(VertexType.Z, qubit=0, row=3)
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=4)
        g.add_edge((bi, z_a), EdgeType.SIMPLE)
        g.add_edge((z_a, z_b), EdgeType.HADAMARD)
        g.add_edge((z_b, z_c), EdgeType.HADAMARD)
        g.add_edge((z_c, bo), EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])
        g_orig = g.copy()

        result = zx.pivot_boundary_for_apply(g, [z_a, z_b])
        self.assertTrue(result)
        self.assertTrue(zx.compare_tensors(g_orig, g, preserve_scalar=False))

    def test_2_qubit_boundary(self):
        """2-qubit graph: z_a boundary-adjacent, z_b interior only."""
        # pivot_boundary requires exactly ONE vertex to be boundary-adjacent
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z_a = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z_b = g.add_vertex(VertexType.Z, qubit=0.5, row=2)
        z_c = g.add_vertex(VertexType.Z, qubit=0, row=3)
        z_d = g.add_vertex(VertexType.Z, qubit=1, row=3)
        bo1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=4)
        bo2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=4)
        g.add_edge((bi, z_a), EdgeType.SIMPLE)
        g.add_edge((z_a, z_b), EdgeType.HADAMARD)
        g.add_edge((z_b, z_c), EdgeType.HADAMARD)
        g.add_edge((z_b, z_d), EdgeType.HADAMARD)
        g.add_edge((z_c, bo1), EdgeType.SIMPLE)
        g.add_edge((z_d, bo2), EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo1, bo2])
        g_orig = g.copy()

        result = zx.pivot_boundary_for_apply(g, [z_a, z_b])
        self.assertTrue(result)
        self.assertTrue(zx.compare_tensors(g_orig, g, preserve_scalar=False))


class TestPivotGadget(unittest.TestCase):
    """Pivot gadget (pivot_gadget_for_apply) — non-Clifford pair."""

    def test_non_clifford_pair(self):
        """Non-Clifford spider adjacent to Clifford → gadgetize + pivot."""
        g = make_graph()
        bi1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        bi2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=1, row=1)
        z_a = g.add_vertex(VertexType.Z, qubit=0, row=2, phase=Fraction(1, 4))
        z_b = g.add_vertex(VertexType.Z, qubit=1, row=2)
        z3 = g.add_vertex(VertexType.Z, qubit=0, row=3)
        z4 = g.add_vertex(VertexType.Z, qubit=1, row=3)
        bo1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=4)
        bo2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=4)
        g.add_edge((bi1, z1), EdgeType.SIMPLE)
        g.add_edge((bi2, z2), EdgeType.SIMPLE)
        g.add_edge((z1, z_a), EdgeType.HADAMARD)
        g.add_edge((z2, z_a), EdgeType.HADAMARD)
        g.add_edge((z_a, z_b), EdgeType.HADAMARD)
        g.add_edge((z_b, z3), EdgeType.HADAMARD)
        g.add_edge((z_b, z4), EdgeType.HADAMARD)
        g.add_edge((z3, bo1), EdgeType.SIMPLE)
        g.add_edge((z4, bo2), EdgeType.SIMPLE)
        g.set_inputs([bi1, bi2])
        g.set_outputs([bo1, bo2])
        g_orig = g.copy()

        result = zx.pivot_gadget_for_apply(g, [z_a, z_b])
        self.assertTrue(result)
        self.assertTrue(zx.compare_tensors(g_orig, g, preserve_scalar=False))


class TestPhaseGadgetFuse(unittest.TestCase):
    """Phase gadget fusion tested via circuit + gadget_simp."""

    def test_circuit_with_phase_gadgets(self):
        """Build a circuit that produces fusible phase gadgets in graph-like form."""
        c = zx.Circuit(3)
        c.add_gate('CNOT', 0, 1)
        c.add_gate('T', 1)
        c.add_gate('CNOT', 1, 2)
        c.add_gate('T', 2)
        c.add_gate('CNOT', 0, 2)
        g = c.to_graph()
        g_orig = g.copy()

        zx.to_graph_like(g)
        self.assertTrue(zx.compare_tensors(g_orig, g, preserve_scalar=False))

        g2 = g.copy()
        zx.gadget_simp(g2)
        self.assertTrue(zx.compare_tensors(g_orig, g2, preserve_scalar=False))

    def test_direct_merge_via_simp(self):
        """Phase gadget merge preserves tensor on a circuit with T gates."""
        c = zx.Circuit(2)
        c.add_gate('CNOT', 0, 1)
        c.add_gate('T', 0)
        c.add_gate('CNOT', 0, 1)
        c.add_gate('T', 0)
        g = c.to_graph()
        g_orig = g.copy()

        zx.gadget_simp(g)
        self.assertTrue(zx.compare_tensors(g_orig, g, preserve_scalar=False))


class TestSupplementarity(unittest.TestCase):
    """Supplementarity (safe_apply_supplementarity)."""

    def test_complementary_phases(self):
        """Two spiders with phases summing to 0 mod 2, same neighbor set."""
        g = make_graph()
        bi1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        bi2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=1, row=1)
        v = g.add_vertex(VertexType.Z, qubit=0.3, row=2, phase=Fraction(1, 4))
        w = g.add_vertex(VertexType.Z, qubit=0.7, row=2, phase=Fraction(7, 4))
        bo1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        bo2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=3)
        g.add_edge((bi1, z1), EdgeType.SIMPLE)
        g.add_edge((bi2, z2), EdgeType.SIMPLE)
        g.add_edge((z1, v), EdgeType.HADAMARD)
        g.add_edge((z1, w), EdgeType.HADAMARD)
        g.add_edge((z2, v), EdgeType.HADAMARD)
        g.add_edge((z2, w), EdgeType.HADAMARD)
        g.add_edge((v, w), EdgeType.HADAMARD)
        g.add_edge((z1, bo1), EdgeType.SIMPLE)
        g.add_edge((z2, bo2), EdgeType.SIMPLE)
        g.set_inputs([bi1, bi2])
        g.set_outputs([bo1, bo2])

        g2 = g.copy()
        result = zx.safe_apply_supplementarity(g2, [v, w])
        self.assertTrue(result)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_different_non_clifford_phases(self):
        """pi/3 + 5pi/3 = 2pi ≡ 0 mod 2."""
        g = make_graph()
        bi1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        bi2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=1, row=1)
        v = g.add_vertex(VertexType.Z, qubit=0.3, row=2, phase=Fraction(1, 3))
        w = g.add_vertex(VertexType.Z, qubit=0.7, row=2, phase=Fraction(5, 3))
        bo1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        bo2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=3)
        g.add_edge((bi1, z1), EdgeType.SIMPLE)
        g.add_edge((bi2, z2), EdgeType.SIMPLE)
        g.add_edge((z1, v), EdgeType.HADAMARD)
        g.add_edge((z1, w), EdgeType.HADAMARD)
        g.add_edge((z2, v), EdgeType.HADAMARD)
        g.add_edge((z2, w), EdgeType.HADAMARD)
        g.add_edge((v, w), EdgeType.HADAMARD)
        g.add_edge((z1, bo1), EdgeType.SIMPLE)
        g.add_edge((z2, bo2), EdgeType.SIMPLE)
        g.set_inputs([bi1, bi2])
        g.set_outputs([bo1, bo2])

        g2 = g.copy()
        result = zx.safe_apply_supplementarity(g2, [v, w])
        self.assertTrue(result)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


# ---------------------------------------------------------------------------
# Part 1B — Edge case expansion for already-tested rules
# ---------------------------------------------------------------------------

class TestGadgetizeEdgeCases(unittest.TestCase):
    """Additional gadgetize edge cases."""

    def test_arity_1_spider(self):
        """Gadgetize on a degree-1 (arity 1) spider."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([])

        g2 = g.copy()
        apply_gadgetize(g2, z)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestHopfEdgeCases(unittest.TestCase):
    """Additional Hopf edge cases."""

    def test_phased_spiders(self):
        """Phase should be unaffected by Hopf edge removal."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2, phase=Fraction(1, 2))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_hopf(g2, z1, z2)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))
        # Phases should be unchanged
        self.assertEqual(g2.phase(z1), Fraction(1, 4))
        self.assertEqual(g2.phase(z2), Fraction(1, 2))

    def test_pyzx_hopf(self):
        """Verify PyZX's built-in check_hopf/unsafe_hopf matches custom impl."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        self.assertTrue(zx.check_hopf(g, z1, z2))
        g2 = g.copy()
        zx.unsafe_hopf(g2, z1, z2)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestCopyRuleEdgeCases(unittest.TestCase):
    """Additional copy rule edge cases."""

    def test_x_spider_copy(self):
        """X spider degree-1 copied through Z neighbor."""
        g = make_graph()
        b_in1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b_in2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        x_copy = g.add_vertex(VertexType.X, qubit=-0.5, row=1)
        z_target = g.add_vertex(VertexType.Z, qubit=0.5, row=1)
        b_out1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        b_out2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=2)
        g.add_edge((b_in1, z_target), EdgeType.SIMPLE)
        g.add_edge((b_in2, z_target), EdgeType.SIMPLE)
        g.add_edge((x_copy, z_target), EdgeType.SIMPLE)
        g.add_edge((z_target, b_out1), EdgeType.SIMPLE)
        g.add_edge((z_target, b_out2), EdgeType.SIMPLE)
        g.set_inputs([b_in1, b_in2])
        g.set_outputs([b_out1, b_out2])

        self.assertTrue(zx.check_bialgebra(g, x_copy, z_target))
        g2 = g.copy()
        zx.unsafe_bialgebra(g2, x_copy, z_target)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestPushPauliEdgeCases(unittest.TestCase):
    """Additional push Pauli edge cases."""

    def test_x_pi_through_z(self):
        """Push X(pi) through Z spider via simple edge."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        x_pi = g.add_vertex(VertexType.X, qubit=0, row=1, phase=Fraction(1))
        z_target = g.add_vertex(VertexType.Z, qubit=0, row=2, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, x_pi), EdgeType.SIMPLE)
        g.add_edge((x_pi, z_target), EdgeType.SIMPLE)
        g.add_edge((z_target, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_push_pauli(g2, x_pi, z_target)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_pyzx_pauli_push(self):
        """Verify PyZX's check_pauli/unsafe_pauli_push matches custom impl."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z_pi = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1))
        z_tgt = g.add_vertex(VertexType.Z, qubit=0, row=2, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z_pi), EdgeType.SIMPLE)
        g.add_edge((z_pi, z_tgt), EdgeType.HADAMARD)
        g.add_edge((z_tgt, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        # check_pauli(g, v, w): v = spider to push THROUGH, w = Pauli spider
        # (reversed from our custom impl where v=Pauli, n=target)
        self.assertTrue(zx.check_pauli(g, z_tgt, z_pi))
        g2 = g.copy()
        zx.unsafe_pauli_push(g2, z_tgt, z_pi)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


    def test_degree_3_pauli(self):
        """Push Z(pi) degree-3 through X(pi/2) via simple edge.

        Z(pi) has degree 3 (two boundary inputs + one edge to target),
        triggering the else branch in unsafe_pauli_push where phase is
        zeroed before being read. This catches the PyZX mutation-ordering bug.
        """
        g = make_graph()
        b_in1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b_in2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z_pi = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1))
        x_tgt = g.add_vertex(VertexType.X, qubit=0, row=2, phase=Fraction(1, 2))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in1, z_pi), EdgeType.SIMPLE)
        g.add_edge((b_in2, z_pi), EdgeType.SIMPLE)
        g.add_edge((z_pi, x_tgt), EdgeType.SIMPLE)
        g.add_edge((x_tgt, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in1, b_in2])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_push_pauli(g2, z_pi, x_tgt)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_degree_3_pauli_pyzx_native(self):
        """Degree-3 Pauli push using native PyZX unsafe_pauli_push (bug fixed upstream)."""
        from pyzx.rewrite_rules.push_pauli_rule import unsafe_pauli_push

        g = make_graph()
        b_in1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b_in2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z_pi = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1))
        x_tgt = g.add_vertex(VertexType.X, qubit=0, row=2, phase=Fraction(1, 2))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in1, z_pi), EdgeType.SIMPLE)
        g.add_edge((b_in2, z_pi), EdgeType.SIMPLE)
        g.add_edge((z_pi, x_tgt), EdgeType.SIMPLE)
        g.add_edge((x_tgt, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in1, b_in2])
        g.set_outputs([b_out])

        g2 = g.copy()
        unsafe_pauli_push(g2, x_tgt, z_pi)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestSelfLoopEdgeCases(unittest.TestCase):
    """Additional self-loop edge cases."""

    def test_x_spider_had_self_loop(self):
        """X spider with Hadamard self-loop → absorb as +pi."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        x = g.add_vertex(VertexType.X, qubit=0, row=1, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((b_in, x), EdgeType.SIMPLE)
        g.add_edge((x, x), EdgeType.HADAMARD)
        g.add_edge((x, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_self_loop_removal(g2, x)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_pyzx_self_loop(self):
        """Verify PyZX's check_self_loop/unsafe_remove_self_loop."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, z), EdgeType.HADAMARD)
        g.add_edge((z, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        self.assertTrue(zx.check_self_loop(g, z))
        g2 = g.copy()
        zx.unsafe_remove_self_loop(g2, z)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


# ---------------------------------------------------------------------------
# Part 1C — Simplification strategy tensor tests
# ---------------------------------------------------------------------------

class TestSimplifications(unittest.TestCase):
    """Simplification strategies must preserve tensor on known circuits."""

    def _make_circuit_graph(self):
        """2-qubit circuit with T gates for testing simplifications."""
        c = zx.Circuit(2)
        c.add_gate('CNOT', 0, 1)
        c.add_gate('T', 0)
        c.add_gate('H', 0)
        c.add_gate('T', 1)
        c.add_gate('CNOT', 0, 1)
        return c.to_graph()

    def _make_clifford_circuit_graph(self):
        """2-qubit Clifford circuit."""
        c = zx.Circuit(2)
        c.add_gate('CNOT', 0, 1)
        c.add_gate('H', 0)
        c.add_gate('S', 1)
        c.add_gate('CNOT', 1, 0)
        return c.to_graph()

    def test_clifford_simp(self):
        """clifford_simp preserves tensor on Clifford circuit."""
        g = self._make_clifford_circuit_graph()
        g_orig = g.copy()
        zx.clifford_simp(g)
        self.assertTrue(zx.compare_tensors(g_orig, g, preserve_scalar=False))

    def test_full_reduce(self):
        """full_reduce preserves tensor on circuit with T gates."""
        g = self._make_circuit_graph()
        g_orig = g.copy()
        zx.full_reduce(g)
        self.assertTrue(zx.compare_tensors(g_orig, g, preserve_scalar=False))

    def test_to_graph_like(self):
        """to_graph_like preserves tensor."""
        g = self._make_circuit_graph()
        g_orig = g.copy()
        zx.to_graph_like(g)
        self.assertTrue(zx.compare_tensors(g_orig, g, preserve_scalar=False))

    def test_interior_clifford_simp(self):
        """interior_clifford_simp preserves tensor."""
        g = self._make_circuit_graph()
        g_orig = g.copy()
        zx.simplify.interior_clifford_simp(g)
        self.assertTrue(zx.compare_tensors(g_orig, g, preserve_scalar=False))

    def test_teleport_reduce(self):
        """teleport_reduce preserves tensor."""
        g = self._make_circuit_graph()
        g_orig = g.copy()
        zx.teleport_reduce(g)
        self.assertTrue(zx.compare_tensors(g_orig, g, preserve_scalar=False))


# ---------------------------------------------------------------------------
# Regression: the exact proof-4 scenario
# ---------------------------------------------------------------------------

class TestGadgetizeRegression(unittest.TestCase):
    """Regression: the exact scenario from proof-4 step 15."""

    def test_proof4_step14_to_step15(self):
        """Gadgetize Z(1/4) spider in a multi-spider graph."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2, phase=Fraction(3, 4))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, z2), EdgeType.SIMPLE)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        apply_gadgetize(g2, 1)

        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False),
                        "Gadgetize with SIMPLE edge must preserve tensor!")

        # Also verify HADAMARD is wrong
        g_bad = g.copy()
        phase = g_bad.phase(1)
        g_bad.set_phase(1, Fraction(0))
        new_v = g_bad.add_vertex(VertexType.Z, qubit=0.5, row=1.5, phase=phase)
        g_bad.add_edge((1, new_v), EdgeType.HADAMARD)

        self.assertFalse(zx.compare_tensors(g, g_bad, preserve_scalar=False),
                         "Gadgetize with HADAMARD edge must NOT preserve tensor!")


class TestHopfWorkerPath(unittest.TestCase):
    """Test Hopf matching via the worker's full pipeline.

    The JSON must include auto_simplify=false so PyZX's Multigraph preserves
    parallel edges (otherwise add_edge reduces them mod 2 before the matcher
    ever sees them).
    """

    def test_zx_parallel_simple_match(self):
        """Z-X connected by 2 parallel simple edges → Hopf match."""
        from tests.worker_functions import zxs_find_matches, zxs_apply_rewrite
        graph = {
            'version': 2, 'backend': 'multigraph', 'auto_simplify': False,
            'variable_types': {},
            'inputs': [2], 'outputs': [3],
            'vertices': [
                {'id': 0, 't': 1, 'pos': [1, 0]},   # Z
                {'id': 1, 't': 2, 'pos': [2, 0]},   # X
                {'id': 2, 't': 0, 'pos': [0, 0]},   # input
                {'id': 3, 't': 0, 'pos': [3, 0]},   # output
            ],
            'edges': [[2, 0, 1], [0, 1, 1], [0, 1, 1], [1, 3, 1]],
        }
        graph_json = json.dumps(graph)

        matches = json.loads(zxs_find_matches(graph_json, 'hopf'))
        self.assertEqual(len(matches), 1)
        self.assertEqual(sorted(matches[0]), [0, 1])

        result = zxs_apply_rewrite(graph_json, 'hopf', json.dumps(matches[0]))
        result_data = json.loads(result)
        # Parallel edges removed, boundary edges remain
        self.assertEqual(len(result_data['edges']), 2)

        # Tensor check: before and after should be equivalent
        g_before = zx.Graph.from_json(graph_json)
        g_after = zx.Graph.from_json(result)
        self.assertTrue(zx.compare_tensors(g_before, g_after, preserve_scalar=False))

    def test_zz_parallel_hadamard_match(self):
        """Z-Z connected by 2 parallel Hadamard edges → Hopf match."""
        from tests.worker_functions import zxs_find_matches, zxs_apply_rewrite
        graph = {
            'version': 2, 'backend': 'multigraph', 'auto_simplify': False,
            'variable_types': {},
            'inputs': [2], 'outputs': [3],
            'vertices': [
                {'id': 0, 't': 1, 'pos': [1, 0]},
                {'id': 1, 't': 1, 'pos': [2, 0]},
                {'id': 2, 't': 0, 'pos': [0, 0]},
                {'id': 3, 't': 0, 'pos': [3, 0]},
            ],
            'edges': [[2, 0, 1], [0, 1, 2], [0, 1, 2], [1, 3, 1]],
        }
        graph_json = json.dumps(graph)

        matches = json.loads(zxs_find_matches(graph_json, 'hopf'))
        self.assertEqual(len(matches), 1)

        result = zxs_apply_rewrite(graph_json, 'hopf', json.dumps(matches[0]))
        g_before = zx.Graph.from_json(graph_json)
        g_after = zx.Graph.from_json(result)
        self.assertTrue(zx.compare_tensors(g_before, g_after, preserve_scalar=False))

    def test_no_match_single_edge(self):
        """Single edge → no Hopf match."""
        from tests.worker_functions import zxs_find_matches
        graph = {
            'version': 2, 'backend': 'multigraph', 'auto_simplify': False,
            'variable_types': {},
            'inputs': [], 'outputs': [],
            'vertices': [
                {'id': 0, 't': 1, 'pos': [0, 0]},
                {'id': 1, 't': 2, 'pos': [1, 0]},
            ],
            'edges': [[0, 1, 1]],
        }
        matches = json.loads(zxs_find_matches(json.dumps(graph), 'hopf'))
        self.assertEqual(len(matches), 0)

    def test_no_match_wrong_edge_type(self):
        """Z-X with 2 parallel Hadamard edges → NOT a Hopf match (wrong type)."""
        from tests.worker_functions import zxs_find_matches
        graph = {
            'version': 2, 'backend': 'multigraph', 'auto_simplify': False,
            'variable_types': {},
            'inputs': [], 'outputs': [],
            'vertices': [
                {'id': 0, 't': 1, 'pos': [0, 0]},
                {'id': 1, 't': 2, 'pos': [1, 0]},
            ],
            'edges': [[0, 1, 2], [0, 1, 2]],
        }
        matches = json.loads(zxs_find_matches(json.dumps(graph), 'hopf'))
        self.assertEqual(len(matches), 0)


# ---------------------------------------------------------------------------
# BPW2020 Stabilizer Axiom Tests
# ---------------------------------------------------------------------------

from worker_functions import (
    _apply_euler_prime, _apply_euler_prime_rev,
    _find_euler_prime_rev_matches,
    _apply_b1_copy, _find_b1_copy_matches,
    _apply_b1_uncopy, _find_b1_uncopy_matches,
    _apply_identity_void, _apply_identity_void_rev,
    _find_identity_void_matches,
    _apply_zero_op, _find_zero_op_matches,
    _apply_zero_op_rev, _find_zero_op_rev_matches,
)


class TestEulerPrime(unittest.TestCase):
    """EU' — Hadamard edge → Z(π/2)-X(0)-Z(π/2) chain with Z(-π/2) leaf."""

    def test_between_z_spiders(self):
        """EU' on Hadamard edge between two Z spiders preserves tensor."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        _apply_euler_prime(g2, 1, 2)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_between_z_and_x(self):
        """EU' on Hadamard edge between Z and X spiders."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        x = g.add_vertex(VertexType.X, qubit=0, row=2, phase=Fraction(1, 2))
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z), EdgeType.SIMPLE)
        g.add_edge((z, x), EdgeType.HADAMARD)
        g.add_edge((x, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        _apply_euler_prime(g2, 1, 2)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_roundtrip(self):
        """EU' then EU'⁻¹ returns to original tensor."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z1), EdgeType.SIMPLE)
        g.add_edge((z1, z2), EdgeType.HADAMARD)
        g.add_edge((z2, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        _apply_euler_prime(g2, 1, 2)
        # Find the reverse pattern and apply
        matches = _find_euler_prime_rev_matches(g2)
        self.assertTrue(len(matches) > 0, "Should find EU' reverse match")
        _apply_euler_prime_rev(g2, matches[0])
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_2_qubit(self):
        """EU' on a 2-qubit graph (CNOT-like with Hadamard)."""
        g = make_graph()
        b0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b1 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1)
        x = g.add_vertex(VertexType.X, qubit=1, row=1)
        b2 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        b3 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=2)
        g.add_edge((b0, z), EdgeType.SIMPLE)
        g.add_edge((b1, x), EdgeType.SIMPLE)
        g.add_edge((z, x), EdgeType.HADAMARD)
        g.add_edge((z, b2), EdgeType.SIMPLE)
        g.add_edge((x, b3), EdgeType.SIMPLE)
        g.set_inputs([b0, b1])
        g.set_outputs([b2, b3])

        g2 = g.copy()
        _apply_euler_prime(g2, 2, 3)
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))


class TestB1Copy(unittest.TestCase):
    """B1 — Copy rule with scalar consumption."""

    def _make_b1_graph(self):
        """Create a graph with Z(0)-X(0) structure + scalar pair + I/O."""
        g = make_graph()
        # Main structure: boundary → Z(0) → boundary, with X(0) leaf on Z
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z_hub = g.add_vertex(VertexType.Z, qubit=0.5, row=1)
        x_leaf = g.add_vertex(VertexType.X, qubit=0.5, row=2)
        g.add_edge((b_in, z_hub), EdgeType.SIMPLE)
        g.add_edge((b_out, z_hub), EdgeType.SIMPLE)
        g.add_edge((z_hub, x_leaf), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])
        # Scalar pair: Z(0)-X(0) connected by one edge
        sc_z = g.add_vertex(VertexType.Z, qubit=3, row=0)
        sc_x = g.add_vertex(VertexType.X, qubit=3, row=1)
        g.add_edge((sc_z, sc_x), EdgeType.SIMPLE)
        return g, z_hub, x_leaf, sc_z, sc_x

    def test_basic_copy(self):
        """B1 copy preserves tensor."""
        g, z_hub, x_leaf, sc_z, sc_x = self._make_b1_graph()
        g2 = g.copy()
        _apply_b1_copy(g2, [z_hub, x_leaf, sc_z, sc_x])
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_matcher_finds(self):
        """B1 matcher finds the pattern when scalar pair exists."""
        g, z_hub, x_leaf, sc_z, sc_x = self._make_b1_graph()
        matches = _find_b1_copy_matches(g)
        self.assertTrue(len(matches) > 0, "Should find B1 match")

    def test_no_match_without_scalar(self):
        """B1 matcher returns empty when no scalar pair exists."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z_hub = g.add_vertex(VertexType.Z, qubit=0, row=1)
        x_leaf = g.add_vertex(VertexType.X, qubit=0, row=2)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((b_in, z_hub), EdgeType.SIMPLE)
        g.add_edge((z_hub, x_leaf), EdgeType.SIMPLE)
        g.add_edge((z_hub, b_out), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])
        matches = _find_b1_copy_matches(g)
        self.assertEqual(len(matches), 0)


class TestB1Uncopy(unittest.TestCase):
    """B1⁻¹ — Uncopy (reverse of B1, creates scalar pair)."""

    def test_basic_uncopy(self):
        """B1⁻¹ preserves tensor."""
        g = make_graph()
        b_in = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        b_out = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        x1 = g.add_vertex(VertexType.X, qubit=0, row=1)
        x2 = g.add_vertex(VertexType.X, qubit=1, row=1)
        g.add_edge((b_in, x1), EdgeType.SIMPLE)
        g.add_edge((b_out, x2), EdgeType.SIMPLE)
        g.set_inputs([b_in])
        g.set_outputs([b_out])

        g2 = g.copy()
        _apply_b1_uncopy(g2, [x1, x2])
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_matcher_finds_pairs(self):
        """B1⁻¹ matcher finds X(0) degree-1 pairs."""
        g = make_graph()
        b = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        x1 = g.add_vertex(VertexType.X, qubit=0, row=1)
        x2 = g.add_vertex(VertexType.X, qubit=1, row=1)
        b2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        g.add_edge((b, x1), EdgeType.SIMPLE)
        g.add_edge((b2, x2), EdgeType.SIMPLE)
        g.set_inputs([b])
        g.set_outputs([b2])
        matches = _find_b1_uncopy_matches(g)
        self.assertTrue(len(matches) > 0)


class TestIdentityVoid(unittest.TestCase):
    """IV' — Identity Void rule."""

    def _make_iv_pattern(self):
        """Create a graph containing the IV' scalar pattern (5 vertices)."""
        g = make_graph()
        # Two Z-X pairs with 3 parallel edges each
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=0)
        x1 = g.add_vertex(VertexType.X, qubit=0, row=1)
        g.add_edge((z1, x1), EdgeType.SIMPLE)
        g.add_edge((z1, x1), EdgeType.SIMPLE)
        g.add_edge((z1, x1), EdgeType.SIMPLE)
        z2 = g.add_vertex(VertexType.Z, qubit=2, row=0)
        x2 = g.add_vertex(VertexType.X, qubit=2, row=1)
        g.add_edge((z2, x2), EdgeType.SIMPLE)
        g.add_edge((z2, x2), EdgeType.SIMPLE)
        g.add_edge((z2, x2), EdgeType.SIMPLE)
        # Phaseless Z scalar (degree 0)
        sc = g.add_vertex(VertexType.Z, qubit=1, row=-1)
        return g, [z1, x1, z2, x2, sc]

    def test_matcher_finds_pattern(self):
        """IV' matcher finds the 5-vertex pattern."""
        g, match = self._make_iv_pattern()
        matches = _find_identity_void_matches(g)
        self.assertTrue(len(matches) > 0, "Should find IV' pattern")

    def test_apply_removes_pattern(self):
        """IV' removes the pattern, leaving nothing."""
        g, match = self._make_iv_pattern()
        _apply_identity_void(g, match)
        self.assertEqual(g.num_vertices(), 0)

    def test_roundtrip(self):
        """IV'⁻¹ then IV' returns to empty (scalar equality)."""
        g = make_graph()
        # Start empty, create pattern, then remove it
        _apply_identity_void_rev(g, [])
        self.assertEqual(g.num_vertices(), 5)
        matches = _find_identity_void_matches(g)
        self.assertTrue(len(matches) > 0, "Should find created pattern")
        _apply_identity_void(g, matches[0])
        self.assertEqual(g.num_vertices(), 0)


class TestZeroOperator(unittest.TestCase):
    """ZO' — Zero Operator rule."""

    def test_z_to_x(self):
        """ZO' changes Z(0) deg-1 to X(0) in presence of Z(π) scalar."""
        g = make_graph()
        b = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1)
        g.add_edge((b, z), EdgeType.SIMPLE)
        g.set_inputs([b])
        # Z(pi) scalar
        pi_sc = g.add_vertex(VertexType.Z, qubit=2, row=0, phase=Fraction(1))

        g2 = g.copy()
        matches = _find_zero_op_matches(g2)
        self.assertTrue(len(matches) > 0, "Should find ZO' match")
        _apply_zero_op(g2, matches[0])
        # The diagram is zero (pi scalar = 1+e^{iπ} = 0), so tensor comparison
        # should show both are zero maps
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_x_to_z(self):
        """ZO'⁻¹ changes X(0) deg-1 to Z(0) in presence of Z(π) scalar."""
        g = make_graph()
        b = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        x = g.add_vertex(VertexType.X, qubit=0, row=1)
        g.add_edge((b, x), EdgeType.SIMPLE)
        g.set_inputs([b])
        pi_sc = g.add_vertex(VertexType.Z, qubit=2, row=0, phase=Fraction(1))

        g2 = g.copy()
        matches = _find_zero_op_rev_matches(g2)
        self.assertTrue(len(matches) > 0, "Should find ZO'⁻¹ match")
        _apply_zero_op_rev(g2, matches[0])
        self.assertTrue(zx.compare_tensors(g, g2, preserve_scalar=False))

    def test_no_match_without_pi_scalar(self):
        """ZO' returns no matches without Z(π) scalar."""
        g = make_graph()
        b = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1)
        g.add_edge((b, z), EdgeType.SIMPLE)
        g.set_inputs([b])
        matches = _find_zero_op_matches(g)
        self.assertEqual(len(matches), 0)


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    unittest.main(verbosity=2)
