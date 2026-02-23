"""Extracted Python functions from pyodide-worker.mjs for integration testing.

This module recreates the worker's Python code so it can be tested via pytest
without needing Pyodide. All logic is identical to the worker.

Uses PyZX Rewrite instances from pyzx.simplify (ZXLive-style API).
"""

import pyzx as zx
from pyzx.utils import EdgeType, VertexType

# ─── Rewrite instances from pyzx.simplify (ZXLive-style API) ───
from pyzx.simplify import (
    fuse_simp, id_simp, hopf_simp, copy_simp, bialg_simp,
    lcomp_simp, pivot_simp, remove_self_loop_simp,
    euler_expansion_rewrite, color_change_rewrite,
    add_identity_rewrite,
    pivot_boundary_simp, pivot_gadget_simp, gadget_simp,
    supplementarity_simp,
)

# ─── Individual imports only for rules without full Rewrite API ───
from pyzx.rewrite_rules.push_pauli_rule import check_pauli
from pyzx.rewrite_rules.fuse_rule import unfuse as _unfuse
from pyzx.rewrite_rules.bialgebra_rule import match_bialgebra_op, unsafe_bialgebra_op
from pyzx.rewrite_rules.pivot_rule import match_pivot_boundary, match_pivot_gadget
from pyzx.rewrite_rules.merge_phase_gadget_rule import match_phase_gadgets
from pyzx.rewrite_rules.supplementarity_rule import match_supplementarity

# ─── Pauli push bug workaround internals ───
from pyzx.utils import vertex_is_zx, toggle_vertex
from pyzx.graph.base import upair

import json
from fractions import Fraction

# ─── Declarative rule tables ───
# Maps rule name → Rewrite instance. find_all_matches() returns:
#   _SINGLE_RULES: set of int vertex IDs
#   _DOUBLE_RULES: set of (v1, v2) tuples

_SINGLE_RULES = {
    'id_removal': id_simp,
    'copy': copy_simp,
    'color_change': color_change_rewrite,
    'lcomp': lcomp_simp,
    'self_loops': remove_self_loop_simp,
}
_DOUBLE_RULES = {
    'spider_fusion': fuse_simp,
    'hopf': hopf_simp,
    'pivot': pivot_simp,
    'decompose_hadamard': euler_expansion_rewrite,
}
# bialgebra NOT in table: find_all_matches uses check_bialgebra_reduce (too strict).
# We match with is_match (= check_bialgebra) and apply with bialg_simp.apply().


# ─── Fixed pauli push (workaround for PyZX degree>2 bug) ───

def _fixed_pauli_push(g, v, w):
    """Push Pauli w through spider v. Fixed version that saves phase before zeroing."""
    rem_verts = []
    rem_edges = []
    etab = dict()

    pauli_phase = g.phase(w)  # Save BEFORE any mutation

    if g.vertex_degree(w) == 2:
        rem_verts.append(w)
        l = list(g.neighbors(w))
        l.remove(v)
        v2 = l[0]
        et1 = g.edge_type(g.edge(v, w))
        et2 = g.edge_type(g.edge(v2, w))
        etab[upair(v, v2)] = [1, 0] if et1 == et2 else [0, 1]
    else:
        g.set_phase(w, 0)

    new_verts = []
    if vertex_is_zx(g.type(v)):
        g.scalar.add_phase(g.phase(v))
        g.set_phase(v, ((1 - 2 * pauli_phase) * g.phase(v)) % 2)
        t = toggle_vertex(g.type(v))
        p = pauli_phase
    else:
        t = VertexType.Z
        p = 0
    for edge in g.incident_edges(v):
        st = g.edge_st(edge)
        n = st[0] if st[1] == v else st[1]
        if n == w:
            continue
        r = 0.5 * (g.row(n) + g.row(v))
        q = 0.5 * (g.qubit(n) + g.qubit(v))
        et = g.edge_type(edge)
        rem_edges.append(edge)
        w2 = g.add_vertex(t, q, r, p)
        etab[upair(v, w2)] = [1, 0]
        etab[upair(n, w2)] = [1, 0] if et == EdgeType.SIMPLE else [0, 1]
        new_verts.append(w2)
    if not vertex_is_zx(g.type(v)):
        if len(new_verts) == 2:
            etab[upair(new_verts[0], new_verts[1])] = [0, 1]
        else:
            r = (g.row(v) + sum(g.row(n) for n in new_verts)) / (len(new_verts) + 1)
            q = (g.qubit(v) + sum(g.qubit(n) for n in new_verts)) / (len(new_verts) + 1)
            h = g.add_vertex(VertexType.H_BOX, q, r, Fraction(1))
            for n in new_verts:
                etab[upair(h, n)] = [1, 0]

    g.add_edge_table(etab)
    g.remove_vertices(rem_verts)
    g.remove_edges(rem_edges)
    return True


# ─── Precondition checks ───

def _is_graph_like(g):
    """Check if graph is in graph-like form (required by pivot rules).
    Graph-like = no same-color spider pairs connected by Simple edges."""
    for e in g.edges():
        s, t = e[0], e[1]
        if s == t:
            continue
        ts, tt = g.type(s), g.type(t)
        if ts == VertexType.BOUNDARY or tt == VertexType.BOUNDARY:
            continue
        if ts == tt and g.edge_type(e) == EdgeType.SIMPLE:
            return False
    return True


def _find_bialgebra_op_matches(g):
    """Find all valid reverse-bialgebra groups."""
    z_set = set(v for v in g.vertices() if g.type(v) == VertexType.Z and g.phase(v) == 0)
    x_set = set(v for v in g.vertices() if g.type(v) == VertexType.X and g.phase(v) == 0)

    z_to_x = {}
    for z in z_set:
        z_to_x[z] = set(n for n in g.neighbors(z) if n in x_set)

    matches = []
    seen = set()
    z_list = list(z_set)

    for i, z1 in enumerate(z_list):
        for z2 in z_list[i+1:]:
            common_x = z_to_x.get(z1, set()) & z_to_x.get(z2, set())
            if len(common_x) < 2:
                continue
            candidates = list({z1, z2} | common_x)
            for et in (EdgeType.SIMPLE, EdgeType.HADAMARD):
                result = match_bialgebra_op(g, vertices=candidates, edge_type=et)
                if result is not None:
                    key = frozenset(result[0]) | frozenset(result[1])
                    if key not in seen:
                        seen.add(key)
                        matches.append(list(result[0]) + list(result[1]))
    return matches


# ─── Match discovery ───

def _find_matches(g, rule_name):
    """Find matches for a single rule on an already-loaded graph."""

    # ── Table-driven rules (9 of 19) ──
    if rule_name in _SINGLE_RULES:
        return [[v] for v in _SINGLE_RULES[rule_name].find_all_matches(g)]
    if rule_name in _DOUBLE_RULES:
        matches = [list(pair) for pair in _DOUBLE_RULES[rule_name].find_all_matches(g)]
        # decompose_hadamard: filter to edges with at least one ZX endpoint
        if rule_name == 'decompose_hadamard':
            matches = [m for m in matches
                       if g.type(m[0]) in (VertexType.Z, VertexType.X)
                       or g.type(m[1]) in (VertexType.Z, VertexType.X)]
        return matches

    # ── Rules with custom matching (10 of 19) ──

    # bialgebra: uses bialg_simp.is_match (not find_all_matches, see _DOUBLE_RULES note)
    if rule_name == 'bialgebra':
        matches = []
        seen = set()
        for e in g.edges():
            s, t = e[0], e[1]
            if s == t:
                continue
            key = (min(s, t), max(s, t))
            if key in seen:
                continue
            seen.add(key)
            if bialg_simp.is_match(g, s, t):
                matches.append([s, t])
        return matches

    # push_pauli: check_pauli(g, target, pauli). Match = [pauli, target].
    if rule_name == 'push_pauli':
        matches = []
        for v in g.vertices():
            for n in g.neighbors(v):
                if check_pauli(g, n, v):
                    matches.append([v, n])
        return matches

    # unfuse: find any Z/X spider with degree >= 2 (graph query, not ZX semantics)
    if rule_name == 'unfuse':
        matches = []
        for v in g.vertices():
            if g.type(v) not in (VertexType.Z, VertexType.X):
                continue
            if g.vertex_degree(v) >= 2:
                matches.append([v])
        return matches

    # gadgetize: find non-Clifford spiders with degree >= 1 (graph query, not ZX semantics)
    if rule_name == 'gadgetize':
        matches = []
        clifford_phases = {Fraction(0), Fraction(1, 2), Fraction(1), Fraction(3, 2)}
        for v in g.vertices():
            if g.type(v) not in (VertexType.Z, VertexType.X):
                continue
            p = g.phase(v) % 2
            if p not in clifford_phases and g.vertex_degree(v) >= 1:
                matches.append([v])
        return matches

    # wire_vertex: any edge between distinct vertices (graph topology)
    if rule_name == 'wire_vertex':
        matches = []
        seen = set()
        for e in g.edges():
            s, t = e[0], e[1]
            if s == t:
                continue
            key = (min(s, t), max(s, t))
            if key in seen:
                continue
            seen.add(key)
            matches.append([s, t])
        return matches

    # pivot_boundary/pivot_gadget assume graph-like form
    if rule_name == 'pivot_boundary':
        if not _is_graph_like(g):
            return []
        raw = match_pivot_boundary(g, num=-1)
        return [[m[0][0], m[0][1]] for m in raw]

    if rule_name == 'pivot_gadget':
        if not _is_graph_like(g):
            return []
        raw = match_pivot_gadget(g, num=-1)
        return [[m[0][0], m[0][1]] for m in raw]

    # phase_gadget_fuse: assumes graph-like form
    if rule_name == 'phase_gadget_fuse':
        if not _is_graph_like(g):
            return []
        raw = match_phase_gadgets(g)
        result = []
        for v, n, phase, other_axels, other_leaves in raw:
            result.append([v, n] + list(other_axels) + list(other_leaves))
        return result

    if rule_name == 'supplementarity':
        raw = match_supplementarity(g)
        return [[m[0], m[1]] for m in raw]

    if rule_name == 'bialgebra_op':
        return _find_bialgebra_op_matches(g)

    return []


_GRAPH_MUTATING_RULES = {'pivot_boundary', 'pivot_gadget', 'phase_gadget_fuse'}


def zxs_find_matches(graph_json_str, rule_name):
    g = zx.Graph.from_json(graph_json_str)
    return json.dumps(_find_matches(g, rule_name))


def zxs_find_all_matches(graph_json_str, rule_names_json):
    rule_names = json.loads(rule_names_json)
    g = zx.Graph.from_json(graph_json_str)
    results = {}
    for rule_name in rule_names:
        try:
            if rule_name in _GRAPH_MUTATING_RULES:
                g_copy = zx.Graph.from_json(graph_json_str)
                results[rule_name] = _find_matches(g_copy, rule_name)
            else:
                results[rule_name] = _find_matches(g, rule_name)
        except Exception as e:
            import traceback
            print(f"[worker_functions] {rule_name} match error: {e}")
            traceback.print_exc()
            results[rule_name] = []
    return json.dumps(results)


# ─── Rewrite application ───
# Table-driven rules use Rewrite.apply() which calls is_match() internally.
# Custom rules keep explicit precondition checks.

def zxs_apply_rewrite(graph_json_str, rule_name, match_json, unfuse_phase_json=''):
    g = zx.Graph.from_json(graph_json_str)
    match = json.loads(match_json)

    verts = set(g.vertices())
    for v in match:
        if v not in verts:
            return g.to_json()

    # ── Table-driven rules: apply() calls is_match() internally ──
    if rule_name in _SINGLE_RULES:
        _SINGLE_RULES[rule_name].apply(g, match[0])
        return g.to_json()
    if rule_name in _DOUBLE_RULES:
        _DOUBLE_RULES[rule_name].apply(g, match[0], match[1])
        return g.to_json()

    # ── bialgebra: apply() uses is_match (not simp_match) — safe ──
    if rule_name == 'bialgebra':
        bialg_simp.apply(g, match[0], match[1])
        return g.to_json()

    # ── wire_vertex: Rewrite instance without find_all_matches ──
    if rule_name == 'wire_vertex':
        add_identity_rewrite.apply(g, match[0], match[1])
        return g.to_json()

    # ── push_pauli: match = [pauli, target] ──
    if rule_name == 'push_pauli':
        if not check_pauli(g, match[1], match[0]):
            return g.to_json()
        _fixed_pauli_push(g, match[1], match[0])
        return g.to_json()

    # ── unfuse: split a spider (uses native fuse_rule.unfuse) ──
    # match[0] = vertex, match[1:] = neighbors for the new spider (if provided)
    # unfuse_phase_json: optional JSON '{"n":N,"d":D}' — phase for the new node (fraction of π)
    if rule_name == 'unfuse':
        v = match[0]
        if len(match) > 1:
            neighbors = match[1:]
        else:
            neighbors = list(g.neighbors(v))
        m = [v, neighbors]
        if unfuse_phase_json:
            pd = json.loads(unfuse_phase_json)
            m.append(Fraction(pd['n'], pd['d']))
        new_v = _unfuse(g, m)
        # Offset new vertex so it doesn't sit on top of the original
        g.set_row(new_v, g.row(new_v) + 1.0)
        g.set_qubit(new_v, g.qubit(new_v) + 0.5)
        return g.to_json()

    # ── Compound rules: custom matching, Rewrite.apply() ──
    if rule_name == 'pivot_boundary':
        if not _is_graph_like(g):
            return g.to_json()
        pivot_boundary_simp.apply(g, [match[0], match[1]])
        return g.to_json()

    if rule_name == 'pivot_gadget':
        if not _is_graph_like(g):
            return g.to_json()
        pivot_gadget_simp.apply(g, [match[0], match[1]])
        return g.to_json()

    if rule_name == 'phase_gadget_fuse':
        if not _is_graph_like(g):
            return g.to_json()
        gadget_simp.apply(g, match)
        return g.to_json()

    if rule_name == 'supplementarity':
        supplementarity_simp.apply(g, [match[0], match[1]])
        return g.to_json()

    # bialgebra_op: try both SIMPLE and HADAMARD edge types
    # Cannot use bialg_op_simp.apply() — it defaults to SIMPLE only.
    if rule_name == 'bialgebra_op':
        z_verts = [v for v in match if g.type(v) == VertexType.Z]
        x_verts = [v for v in match if g.type(v) == VertexType.X]
        if len(z_verts) < 2 or len(x_verts) < 2:
            return g.to_json()
        for et in (EdgeType.SIMPLE, EdgeType.HADAMARD):
            validated = match_bialgebra_op(g, vertices=match, edge_type=et)
            if validated is not None:
                unsafe_bialgebra_op(g, validated, edge_type=et)
                break
        return g.to_json()

    # ── gadgetize: unfuse with empty neighbor list (extracts phase to leaf) ──
    if rule_name == 'gadgetize':
        v = match[0]
        new_v = _unfuse(g, [v, [], g.phase(v)])
        g.set_row(new_v, g.row(v) + 1.0)
        g.set_qubit(new_v, g.qubit(v) + 0.5)
        return g.to_json()

    raise ValueError(f"Unknown rule: {rule_name}")


def zxs_simplify(graph_json_str, strategy):
    """Mirrors worker zxs_simplify with auto_simplify toggle fix."""
    g = zx.Graph.from_json(graph_json_str)
    g._auto_simplify = True
    if strategy == 'full_reduce':
        zx.full_reduce(g)
    elif strategy == 'spider_simp':
        zx.simplify.spider_simp(g)
    elif strategy == 'clifford_simp':
        zx.simplify.clifford_simp(g)
    elif strategy == 'to_graph_like':
        zx.simplify.to_graph_like(g)
    else:
        raise ValueError(f"Unknown strategy: {strategy}")
    g._auto_simplify = False
    return g.to_json()


def zxs_compare_tensors(g1_json, g2_json):
    """Compare two graphs for semantic equality."""
    g1 = zx.Graph.from_json(g1_json)
    g2 = zx.Graph.from_json(g2_json)
    return bool(zx.compare_tensors(g1, g2))
