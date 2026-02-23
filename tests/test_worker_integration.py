"""Worker integration tests — full pipeline through extracted worker functions.

Tests the complete round-trip: build graph → to_json → zxs_find_matches →
zxs_apply_rewrite → compare_tensors. Validates JSON serialization,
Graph.from_json loading, and match/apply dispatchers.

Uses the extracted worker code from tests/worker_functions.py.
Requires local PyZX git HEAD (not PyPI 0.9.0).
"""

import unittest
import json
from fractions import Fraction

import pyzx as zx
from pyzx.utils import EdgeType, VertexType

from tests.worker_functions import (
    zxs_find_matches,
    zxs_apply_rewrite,
    zxs_simplify,
    zxs_compare_tensors,
    _find_bialgebra_op_matches,
)


def make_graph():
    """Create a multigraph with auto_simplify off."""
    g = zx.Graph(backend='multigraph')
    g.set_auto_simplify(False)
    return g


def graph_to_worker_json(g):
    """Convert a PyZX graph to JSON matching the worker's expected format."""
    return g.to_json()


class TestFromJson(unittest.TestCase):
    """Test Graph.from_json edge cases."""

    def test_self_loop_preserved(self):
        """Self-loops are preserved in the graph by from_json."""
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1)
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((bi, z), edgetype=EdgeType.SIMPLE)
        g.add_edge((z, z), edgetype=EdgeType.HADAMARD)
        g.add_edge((z, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = g.to_json()
        g2 = zx.Graph.from_json(g_json)
        # Self-loop should be preserved (not absorbed)
        self.assertEqual(g2.num_edges(), 3)

    def test_no_self_loops_unchanged(self):
        """Graph without self-loops loads correctly."""
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((bi, z), edgetype=EdgeType.SIMPLE)
        g.add_edge((z, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = g.to_json()
        g2 = zx.Graph.from_json(g_json)
        self.assertEqual(g2.num_vertices(), 3)
        self.assertEqual(g2.num_edges(), 2)
        self.assertEqual(g2.phase(z), Fraction(1, 4))


class TestRoundTripSpiderFusion(unittest.TestCase):
    """Spider fusion through the full worker pipeline."""

    def test_z_plus_z(self):
        """Z(0) + Z(0) fusion via worker pipeline."""
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2)
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((bi, z1), edgetype=EdgeType.SIMPLE)
        g.add_edge((z1, z2), edgetype=EdgeType.SIMPLE)
        g.add_edge((z2, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = graph_to_worker_json(g)
        matches_json = zxs_find_matches(g_json, 'spider_fusion')
        matches = json.loads(matches_json)
        self.assertGreater(len(matches), 0)

        result_json = zxs_apply_rewrite(g_json, 'spider_fusion', json.dumps(matches[0]))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestRoundTripIdRemoval(unittest.TestCase):
    """ID removal through the worker pipeline."""

    def test_phaseless_degree_2(self):
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1)
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((bi, z), edgetype=EdgeType.SIMPLE)
        g.add_edge((z, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = graph_to_worker_json(g)
        matches = json.loads(zxs_find_matches(g_json, 'id_removal'))
        self.assertGreater(len(matches), 0)

        result_json = zxs_apply_rewrite(g_json, 'id_removal', json.dumps(matches[0]))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestRoundTripBialgebra(unittest.TestCase):
    """Bialgebra through the worker pipeline."""

    def test_z_x_simple(self):
        g = make_graph()
        bi1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        bi2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0.5, row=1)
        x = g.add_vertex(VertexType.X, qubit=0.5, row=2)
        bo1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        bo2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=3)
        g.add_edge((bi1, z), edgetype=EdgeType.SIMPLE)
        g.add_edge((bi2, z), edgetype=EdgeType.SIMPLE)
        g.add_edge((z, x), edgetype=EdgeType.SIMPLE)
        g.add_edge((x, bo1), edgetype=EdgeType.SIMPLE)
        g.add_edge((x, bo2), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi1, bi2])
        g.set_outputs([bo1, bo2])

        g_json = graph_to_worker_json(g)
        matches = json.loads(zxs_find_matches(g_json, 'bialgebra'))
        self.assertGreater(len(matches), 0)

        result_json = zxs_apply_rewrite(g_json, 'bialgebra', json.dumps(matches[0]))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestRoundTripCopy(unittest.TestCase):
    """Copy rule through the worker pipeline."""

    def test_degree_1_z(self):
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1)
        x = g.add_vertex(VertexType.X, qubit=0, row=2)
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((bi, x), edgetype=EdgeType.SIMPLE)
        g.add_edge((z, x), edgetype=EdgeType.SIMPLE)
        g.add_edge((x, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = graph_to_worker_json(g)
        matches = json.loads(zxs_find_matches(g_json, 'copy'))
        self.assertGreater(len(matches), 0)

        result_json = zxs_apply_rewrite(g_json, 'copy', json.dumps(matches[0]))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestRoundTripColorChange(unittest.TestCase):
    """Color change through the worker pipeline."""

    def test_z_to_x(self):
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((bi, z), edgetype=EdgeType.SIMPLE)
        g.add_edge((z, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = graph_to_worker_json(g)
        matches = json.loads(zxs_find_matches(g_json, 'color_change'))
        self.assertGreater(len(matches), 0)

        result_json = zxs_apply_rewrite(g_json, 'color_change', json.dumps(matches[0]))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestRoundTripHopf(unittest.TestCase):
    """Hopf rule through the worker pipeline."""

    def test_same_color_hadamard_pair(self):
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2)
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((bi, z1), edgetype=EdgeType.SIMPLE)
        g.add_edge((z1, z2), edgetype=EdgeType.HADAMARD)
        g.add_edge((z1, z2), edgetype=EdgeType.HADAMARD)
        g.add_edge((z2, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = graph_to_worker_json(g)
        matches = json.loads(zxs_find_matches(g_json, 'hopf'))
        self.assertGreater(len(matches), 0)

        result_json = zxs_apply_rewrite(g_json, 'hopf', json.dumps(matches[0]))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestRoundTripLComp(unittest.TestCase):
    """Local complementation through the worker pipeline."""

    def test_interior_clifford(self):
        g = make_graph()
        bi1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        bi2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=1, row=1)
        zc = g.add_vertex(VertexType.Z, qubit=0.5, row=2, phase=Fraction(1, 2))
        bo1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        bo2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=3)
        g.add_edge((bi1, z1), edgetype=EdgeType.SIMPLE)
        g.add_edge((bi2, z2), edgetype=EdgeType.SIMPLE)
        g.add_edge((z1, zc), edgetype=EdgeType.HADAMARD)
        g.add_edge((z2, zc), edgetype=EdgeType.HADAMARD)
        g.add_edge((z1, bo1), edgetype=EdgeType.SIMPLE)
        g.add_edge((z2, bo2), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi1, bi2])
        g.set_outputs([bo1, bo2])

        g_json = graph_to_worker_json(g)
        matches = json.loads(zxs_find_matches(g_json, 'lcomp'))
        self.assertGreater(len(matches), 0)

        # Find the match containing zc
        match = None
        for m in matches:
            if zc in m:
                match = m
                break
        self.assertIsNotNone(match)

        result_json = zxs_apply_rewrite(g_json, 'lcomp', json.dumps(match))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestRoundTripPivot(unittest.TestCase):
    """Pivot through the worker pipeline."""

    def test_interior_pair(self):
        g = make_graph()
        bi1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        bi2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=1, row=1)
        za = g.add_vertex(VertexType.Z, qubit=0, row=2)
        zb = g.add_vertex(VertexType.Z, qubit=1, row=2)
        z3 = g.add_vertex(VertexType.Z, qubit=0, row=3)
        z4 = g.add_vertex(VertexType.Z, qubit=1, row=3)
        bo1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=4)
        bo2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=4)
        g.add_edge((bi1, z1), edgetype=EdgeType.SIMPLE)
        g.add_edge((bi2, z2), edgetype=EdgeType.SIMPLE)
        g.add_edge((z1, za), edgetype=EdgeType.HADAMARD)
        g.add_edge((z2, zb), edgetype=EdgeType.HADAMARD)
        g.add_edge((za, zb), edgetype=EdgeType.HADAMARD)
        g.add_edge((za, z3), edgetype=EdgeType.HADAMARD)
        g.add_edge((zb, z4), edgetype=EdgeType.HADAMARD)
        g.add_edge((z3, bo1), edgetype=EdgeType.SIMPLE)
        g.add_edge((z4, bo2), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi1, bi2])
        g.set_outputs([bo1, bo2])

        g_json = graph_to_worker_json(g)
        matches = json.loads(zxs_find_matches(g_json, 'pivot'))
        self.assertGreater(len(matches), 0)

        result_json = zxs_apply_rewrite(g_json, 'pivot', json.dumps(matches[0]))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestRoundTripPushPauli(unittest.TestCase):
    """Push Pauli through the worker pipeline."""

    def test_z_pi_push(self):
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z_pi = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1))
        z_tgt = g.add_vertex(VertexType.Z, qubit=0, row=2, phase=Fraction(1, 4))
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((bi, z_pi), edgetype=EdgeType.SIMPLE)
        g.add_edge((z_pi, z_tgt), edgetype=EdgeType.HADAMARD)
        g.add_edge((z_tgt, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = graph_to_worker_json(g)
        matches = json.loads(zxs_find_matches(g_json, 'push_pauli'))
        self.assertGreater(len(matches), 0)

        result_json = zxs_apply_rewrite(g_json, 'push_pauli', json.dumps(matches[0]))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))

    def test_z_pi_degree_3(self):
        """Push Pauli round-trip with degree-3 Pauli spider.

        Z(pi) has 3 edges (2 boundary inputs + 1 to target), triggering
        the degree > 2 branch in unsafe_pauli_push where the phase-zeroing
        bug occurs. Our _fixed_pauli_push workaround must preserve the tensor.
        """
        g = make_graph()
        bi1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        bi2 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
        z_pi = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1))
        x_tgt = g.add_vertex(VertexType.X, qubit=0, row=2, phase=Fraction(1, 2))
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((bi1, z_pi), edgetype=EdgeType.SIMPLE)
        g.add_edge((bi2, z_pi), edgetype=EdgeType.SIMPLE)
        g.add_edge((z_pi, x_tgt), edgetype=EdgeType.SIMPLE)
        g.add_edge((x_tgt, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi1, bi2])
        g.set_outputs([bo])

        g_json = graph_to_worker_json(g)
        matches = json.loads(zxs_find_matches(g_json, 'push_pauli'))
        self.assertGreater(len(matches), 0)

        result_json = zxs_apply_rewrite(g_json, 'push_pauli', json.dumps(matches[0]))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestRoundTripDecomposeHadamard(unittest.TestCase):
    """Euler decomposition through the worker pipeline."""

    def test_same_color_z(self):
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2)
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((bi, z1), edgetype=EdgeType.SIMPLE)
        g.add_edge((z1, z2), edgetype=EdgeType.HADAMARD)
        g.add_edge((z2, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = graph_to_worker_json(g)
        matches = json.loads(zxs_find_matches(g_json, 'decompose_hadamard'))
        self.assertGreater(len(matches), 0)

        result_json = zxs_apply_rewrite(g_json, 'decompose_hadamard', json.dumps(matches[0]))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestRoundTripGadgetize(unittest.TestCase):
    """Gadgetize through the worker pipeline."""

    def test_non_clifford(self):
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((bi, z), edgetype=EdgeType.SIMPLE)
        g.add_edge((z, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = graph_to_worker_json(g)
        matches = json.loads(zxs_find_matches(g_json, 'gadgetize'))
        self.assertGreater(len(matches), 0)

        result_json = zxs_apply_rewrite(g_json, 'gadgetize', json.dumps(matches[0]))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestRoundTripWireVertex(unittest.TestCase):
    """Wire vertex through the worker pipeline."""

    def test_insert_identity(self):
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1)
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((bi, z), edgetype=EdgeType.SIMPLE)
        g.add_edge((z, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = graph_to_worker_json(g)
        matches = json.loads(zxs_find_matches(g_json, 'wire_vertex'))
        self.assertGreater(len(matches), 0)

        result_json = zxs_apply_rewrite(g_json, 'wire_vertex', json.dumps(matches[0]))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestRoundTripSelfLoops(unittest.TestCase):
    """Self-loop removal through the worker pipeline."""

    def test_hadamard_self_loop(self):
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1)
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((bi, z), edgetype=EdgeType.SIMPLE)
        g.add_edge((z, z), edgetype=EdgeType.HADAMARD)
        g.add_edge((z, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = graph_to_worker_json(g)
        matches = json.loads(zxs_find_matches(g_json, 'self_loops'))
        self.assertGreater(len(matches), 0)

        result_json = zxs_apply_rewrite(g_json, 'self_loops', json.dumps(matches[0]))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestRoundTripUnfuse(unittest.TestCase):
    """Unfuse through the worker pipeline."""

    def test_non_clifford_split(self):
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        z2 = g.add_vertex(VertexType.Z, qubit=0, row=2)
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
        g.add_edge((bi, z), edgetype=EdgeType.SIMPLE)
        g.add_edge((z, z2), edgetype=EdgeType.SIMPLE)
        g.add_edge((z2, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = graph_to_worker_json(g)
        matches = json.loads(zxs_find_matches(g_json, 'unfuse'))
        self.assertGreater(len(matches), 0)

        result_json = zxs_apply_rewrite(g_json, 'unfuse', json.dumps(matches[0]))
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestStaleMatchGuard(unittest.TestCase):
    """Verify stale match detection."""

    def test_nonexistent_vertex_returns_unchanged(self):
        """Applying a match with nonexistent vertex IDs returns unchanged graph."""
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1)
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((bi, z), edgetype=EdgeType.SIMPLE)
        g.add_edge((z, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = graph_to_worker_json(g)
        stale_match = json.dumps([999, 1000])
        result_json = zxs_apply_rewrite(g_json, 'spider_fusion', stale_match)
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


class TestCompareTensors(unittest.TestCase):
    """Test the zxs_compare_tensors wrapper."""

    def test_identical_graphs(self):
        g = make_graph()
        bi = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        bo = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g.add_edge((bi, z), edgetype=EdgeType.SIMPLE)
        g.add_edge((z, bo), edgetype=EdgeType.SIMPLE)
        g.set_inputs([bi])
        g.set_outputs([bo])

        g_json = graph_to_worker_json(g)
        self.assertTrue(zxs_compare_tensors(g_json, g_json))

    def test_different_graphs(self):
        g1 = make_graph()
        bi = g1.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z = g1.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 4))
        bo = g1.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g1.add_edge((bi, z), edgetype=EdgeType.SIMPLE)
        g1.add_edge((z, bo), edgetype=EdgeType.SIMPLE)
        g1.set_inputs([bi])
        g1.set_outputs([bo])

        g2 = make_graph()
        bi2 = g2.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
        z2 = g2.add_vertex(VertexType.Z, qubit=0, row=1, phase=Fraction(1, 2))
        bo2 = g2.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
        g2.add_edge((bi2, z2), edgetype=EdgeType.SIMPLE)
        g2.add_edge((z2, bo2), edgetype=EdgeType.SIMPLE)
        g2.set_inputs([bi2])
        g2.set_outputs([bo2])

        self.assertFalse(zxs_compare_tensors(
            graph_to_worker_json(g1),
            graph_to_worker_json(g2)
        ))


class TestSimplifyAutoSimplify(unittest.TestCase):
    """Batch simplify strategies must toggle auto_simplify=True internally.

    Without this, add_edge_table (used by lcomp, pivot, bialgebra, fuse, etc.)
    accumulates parallel edges instead of reducing mod 2 → tensor corruption.
    Regression test for proof-16 Full Reduce corruption bug.
    """

    def _make_cnot_circuit(self):
        """4-qubit circuit with CNOT structure — triggers multi-edge buildup."""
        g = make_graph()
        ins, outs, zs = [], [], []
        for q in range(4):
            i = g.add_vertex(VertexType.BOUNDARY, qubit=q, row=0)
            o = g.add_vertex(VertexType.BOUNDARY, qubit=q, row=6)
            ins.append(i)
            outs.append(o)
        # Z spiders on each qubit
        for q in range(4):
            z = g.add_vertex(VertexType.Z, qubit=q, row=1)
            zs.append(z)
            g.add_edge((ins[q], z), edgetype=EdgeType.SIMPLE)
        # X spiders for CNOT targets
        x0 = g.add_vertex(VertexType.X, qubit=1, row=2)
        x1 = g.add_vertex(VertexType.X, qubit=3, row=2)
        g.add_edge((zs[0], x0), edgetype=EdgeType.SIMPLE)
        g.add_edge((zs[1], x0), edgetype=EdgeType.SIMPLE)
        g.add_edge((zs[2], x1), edgetype=EdgeType.SIMPLE)
        g.add_edge((zs[3], x1), edgetype=EdgeType.SIMPLE)
        # Connect to outputs
        z_out = []
        for q in range(4):
            zo = g.add_vertex(VertexType.Z, qubit=q, row=4)
            z_out.append(zo)
            g.add_edge((zo, outs[q]), edgetype=EdgeType.SIMPLE)
        g.add_edge((x0, z_out[0]), edgetype=EdgeType.SIMPLE)
        g.add_edge((x0, z_out[1]), edgetype=EdgeType.SIMPLE)
        g.add_edge((x1, z_out[2]), edgetype=EdgeType.SIMPLE)
        g.add_edge((x1, z_out[3]), edgetype=EdgeType.SIMPLE)
        g.set_inputs(ins)
        g.set_outputs(outs)
        return g

    def test_full_reduce_preserves_tensor(self):
        g = self._make_cnot_circuit()
        g_json = graph_to_worker_json(g)
        result_json = zxs_simplify(g_json, 'full_reduce')
        self.assertTrue(zxs_compare_tensors(g_json, result_json))

    def test_full_reduce_no_multi_edge_blowup(self):
        """full_reduce should not produce graphs with more edges than vertices squared."""
        g = self._make_cnot_circuit()
        g_json = graph_to_worker_json(g)
        result_json = zxs_simplify(g_json, 'full_reduce')
        result = zx.Graph.from_json(result_json)
        nv = result.num_vertices()
        ne = result.num_edges()
        # Sanity: edges should be reasonable, not hundreds of multi-edges
        self.assertLessEqual(ne, nv * nv,
                             f"Edge blowup: {ne} edges with only {nv} vertices")

    def test_spider_simp_preserves_tensor(self):
        g = self._make_cnot_circuit()
        g_json = graph_to_worker_json(g)
        result_json = zxs_simplify(g_json, 'spider_simp')
        self.assertTrue(zxs_compare_tensors(g_json, result_json))

    def test_clifford_simp_preserves_tensor(self):
        g = self._make_cnot_circuit()
        g_json = graph_to_worker_json(g)
        result_json = zxs_simplify(g_json, 'clifford_simp')
        self.assertTrue(zxs_compare_tensors(g_json, result_json))


if __name__ == '__main__':
    unittest.main()
