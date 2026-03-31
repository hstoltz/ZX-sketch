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
from pyzx.rewrite_rules.push_pauli_rule import check_pauli, unsafe_pauli_push
from pyzx.rewrite_rules.fuse_rule import unfuse as _unfuse
from pyzx.rewrite_rules.bialgebra_rule import match_bialgebra_op, unsafe_bialgebra_op
from pyzx.rewrite_rules.pivot_rule import match_pivot_boundary, match_pivot_gadget
from pyzx.rewrite_rules.merge_phase_gadget_rule import match_phase_gadgets
from pyzx.rewrite_rules.supplementarity_rule import match_supplementarity

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


# ─── BPW2020 Stabilizer Axiom Implementations ───

def _find_b1_scalar_pairs(g):
    pairs = []
    seen = set()
    for v in g.vertices():
        if v in seen:
            continue
        if g.type(v) != VertexType.Z or g.phase(v) != 0:
            continue
        if g.type(v) == VertexType.BOUNDARY:
            continue
        if g.vertex_degree(v) != 1:
            continue
        for n in g.neighbors(v):
            if n in seen:
                continue
            if g.type(n) != VertexType.X or g.phase(n) != 0:
                continue
            if g.type(n) == VertexType.BOUNDARY:
                continue
            if g.vertex_degree(n) != 1:
                continue
            pairs.append((v, n))
            seen.add(v)
            seen.add(n)
    return pairs

def _find_b1_copy_matches(g):
    scalar_pairs = _find_b1_scalar_pairs(g)
    if not scalar_pairs:
        return []
    sc_z, sc_x = scalar_pairs[0]
    matches = []
    for v in g.vertices():
        if g.type(v) != VertexType.Z or g.phase(v) != 0:
            continue
        if g.type(v) == VertexType.BOUNDARY:
            continue
        if g.vertex_degree(v) < 2:
            continue
        if v == sc_z or v == sc_x:
            continue
        for n in g.neighbors(v):
            if g.type(n) != VertexType.X or g.phase(n) != 0:
                continue
            if g.type(n) == VertexType.BOUNDARY:
                continue
            if g.vertex_degree(n) != 1:
                continue
            if n == sc_z or n == sc_x:
                continue
            et = g.edge_type(g.edge(v, n))
            if et != EdgeType.SIMPLE:
                continue
            matches.append([v, n, sc_z, sc_x])
    return matches

def _apply_b1_copy(g, match):
    z_hub, x_leaf, sc_z, sc_x = match
    other_neighbors = []
    for n in g.neighbors(z_hub):
        if n == x_leaf:
            continue
        et = g.edge_type(g.edge(z_hub, n))
        other_neighbors.append((n, et))
    hub_row, hub_qubit = g.row(z_hub), g.qubit(z_hub)
    g.remove_vertex(sc_z)
    g.remove_vertex(sc_x)
    g.remove_vertex(x_leaf)
    g.remove_vertex(z_hub)
    spread = 0.5
    for i, (n, et) in enumerate(other_neighbors):
        new_x = g.add_vertex(VertexType.X)
        g.set_phase(new_x, Fraction(0))
        offset = (i - (len(other_neighbors) - 1) / 2.0) * spread
        g.set_row(new_x, hub_row + offset)
        g.set_qubit(new_x, hub_qubit + 0.5)
        g.add_edge((new_x, n), edgetype=et)

def _find_b1_uncopy_matches(g):
    candidates = []
    for v in g.vertices():
        if g.type(v) != VertexType.X or g.phase(v) != 0:
            continue
        if g.type(v) == VertexType.BOUNDARY:
            continue
        if g.vertex_degree(v) != 1:
            continue
        candidates.append(v)
    matches = []
    for i in range(len(candidates)):
        for j in range(i + 1, len(candidates)):
            matches.append([candidates[i], candidates[j]])
    return matches

def _apply_b1_uncopy(g, match):
    x1, x2 = match[0], match[1]
    n1 = list(g.neighbors(x1))[0]
    n2 = list(g.neighbors(x2))[0]
    et1 = g.edge_type(g.edge(x1, n1))
    et2 = g.edge_type(g.edge(x2, n2))
    r1, q1 = g.row(x1), g.qubit(x1)
    r2, q2 = g.row(x2), g.qubit(x2)
    g.remove_vertex(x1)
    g.remove_vertex(x2)
    z_hub = g.add_vertex(VertexType.Z)
    g.set_phase(z_hub, Fraction(0))
    g.set_row(z_hub, (r1 + r2) / 2)
    g.set_qubit(z_hub, (q1 + q2) / 2)
    g.add_edge((z_hub, n1), edgetype=et1)
    g.add_edge((z_hub, n2), edgetype=et2)
    x_leaf = g.add_vertex(VertexType.X)
    g.set_phase(x_leaf, Fraction(0))
    g.set_row(x_leaf, g.row(z_hub) + 0.5)
    g.set_qubit(x_leaf, g.qubit(z_hub) + 0.5)
    g.add_edge((z_hub, x_leaf), edgetype=EdgeType.SIMPLE)
    sc_z = g.add_vertex(VertexType.Z)
    g.set_phase(sc_z, Fraction(0))
    g.set_row(sc_z, g.row(z_hub) - 1.0)
    g.set_qubit(sc_z, g.qubit(z_hub) - 0.5)
    sc_x = g.add_vertex(VertexType.X)
    g.set_phase(sc_x, Fraction(0))
    g.set_row(sc_x, g.row(sc_z))
    g.set_qubit(sc_x, g.qubit(sc_z) + 0.5)
    g.add_edge((sc_z, sc_x), edgetype=EdgeType.SIMPLE)

def _find_euler_prime_matches(g):
    matches = []
    seen = set()
    for e in g.edges():
        s, t = e[0], e[1]
        if s == t:
            continue
        if g.edge_type(e) != EdgeType.HADAMARD:
            continue
        key = (min(s, t), max(s, t))
        if key in seen:
            continue
        seen.add(key)
        ts, tt = g.type(s), g.type(t)
        if ts not in (VertexType.Z, VertexType.X) and tt not in (VertexType.Z, VertexType.X):
            continue
        matches.append([s, t])
    return matches

def _apply_euler_prime(g, s, t):
    e = g.edge(s, t)
    g.remove_edge(e)
    rs, rt = g.row(s), g.row(t)
    qs, qt = g.qubit(s), g.qubit(t)
    z1 = g.add_vertex(VertexType.Z)
    g.set_phase(z1, Fraction(1, 2))
    g.set_row(z1, rs + (rt - rs) * 0.25)
    g.set_qubit(z1, qs + (qt - qs) * 0.25)
    x0 = g.add_vertex(VertexType.X)
    g.set_phase(x0, Fraction(0))
    g.set_row(x0, rs + (rt - rs) * 0.5)
    g.set_qubit(x0, qs + (qt - qs) * 0.5)
    z2 = g.add_vertex(VertexType.Z)
    g.set_phase(z2, Fraction(1, 2))
    g.set_row(z2, rs + (rt - rs) * 0.75)
    g.set_qubit(z2, qs + (qt - qs) * 0.75)
    zleaf = g.add_vertex(VertexType.Z)
    g.set_phase(zleaf, Fraction(-1, 2))
    dx, dy = rt - rs, qt - qs
    length = max(abs(dx) + abs(dy), 0.01)
    g.set_row(zleaf, g.row(x0) + (-dy / length) * 0.75)
    g.set_qubit(zleaf, g.qubit(x0) + (dx / length) * 0.75)
    g.add_edge((s, z1), edgetype=EdgeType.SIMPLE)
    g.add_edge((z1, x0), edgetype=EdgeType.SIMPLE)
    g.add_edge((x0, z2), edgetype=EdgeType.SIMPLE)
    g.add_edge((z2, t), edgetype=EdgeType.SIMPLE)
    g.add_edge((x0, zleaf), edgetype=EdgeType.SIMPLE)

def _find_euler_prime_rev_matches(g):
    matches = []
    for x0 in g.vertices():
        if g.type(x0) != VertexType.X or g.phase(x0) != 0:
            continue
        if g.vertex_degree(x0) != 3:
            continue
        neighbors = list(g.neighbors(x0))
        z_half = []
        z_neg_half_leaf = None
        for n in neighbors:
            if g.type(n) != VertexType.Z:
                continue
            e = g.edge(x0, n)
            if g.edge_type(e) != EdgeType.SIMPLE:
                continue
            p = g.phase(n) % 2
            if p == Fraction(1, 2) and g.vertex_degree(n) >= 2:
                z_half.append(n)
            elif (p == Fraction(3, 2) or p == Fraction(-1, 2) % 2) and g.vertex_degree(n) == 1:
                z_neg_half_leaf = n
        if len(z_half) == 2 and z_neg_half_leaf is not None:
            matches.append([z_half[0], x0, z_half[1], z_neg_half_leaf])
    return matches

def _apply_euler_prime_rev(g, match):
    z1, x0, z2, zleaf = match
    s = None
    for n in g.neighbors(z1):
        if n != x0:
            s = n
            break
    t = None
    for n in g.neighbors(z2):
        if n != x0:
            t = n
            break
    if s is None or t is None:
        return
    g.remove_vertex(zleaf)
    g.remove_vertex(x0)
    g.remove_vertex(z1)
    g.remove_vertex(z2)
    g.add_edge((s, t), edgetype=EdgeType.HADAMARD)

def _find_identity_void_matches(g):
    z_scalars = [v for v in g.vertices()
                 if g.type(v) == VertexType.Z and g.phase(v) == 0
                 and g.vertex_degree(v) == 0
                 and g.type(v) != VertexType.BOUNDARY]
    if not z_scalars:
        return []
    pairs = []
    seen = set()
    for v in g.vertices():
        if v in seen:
            continue
        if g.type(v) != VertexType.Z or g.phase(v) != 0:
            continue
        if g.type(v) == VertexType.BOUNDARY:
            continue
        if g.vertex_degree(v) != 3:
            continue
        nbrs = list(g.neighbors(v))
        if len(set(nbrs)) != 1:
            continue
        n = nbrs[0]
        if n in seen:
            continue
        if g.type(n) != VertexType.X or g.phase(n) != 0:
            continue
        if g.type(n) == VertexType.BOUNDARY:
            continue
        if g.vertex_degree(n) != 3:
            continue
        n_nbrs = list(g.neighbors(n))
        if len(set(n_nbrs)) != 1 or n_nbrs[0] != v:
            continue
        pairs.append((v, n))
        seen.add(v)
        seen.add(n)
    if len(pairs) < 2:
        return []
    matches = []
    for i in range(len(pairs)):
        for j in range(i + 1, len(pairs)):
            z1, x1 = pairs[i]
            z2, x2 = pairs[j]
            for sc in z_scalars:
                if sc not in seen:
                    matches.append([z1, x1, z2, x2, sc])
                    break
    return matches

def _apply_identity_void(g, match):
    for v in match:
        if v in g.vertices():
            g.remove_vertex(v)

def _apply_identity_void_rev(g, match):
    base_r, base_q = 0.0, 0.0
    z1 = g.add_vertex(VertexType.Z)
    g.set_phase(z1, Fraction(0))
    g.set_row(z1, base_r)
    g.set_qubit(z1, base_q)
    x1 = g.add_vertex(VertexType.X)
    g.set_phase(x1, Fraction(0))
    g.set_row(x1, base_r + 1.0)
    g.set_qubit(x1, base_q)
    g.add_edge((z1, x1), edgetype=EdgeType.SIMPLE)
    g.add_edge((z1, x1), edgetype=EdgeType.SIMPLE)
    g.add_edge((z1, x1), edgetype=EdgeType.SIMPLE)
    z2 = g.add_vertex(VertexType.Z)
    g.set_phase(z2, Fraction(0))
    g.set_row(z2, base_r)
    g.set_qubit(z2, base_q + 2.0)
    x2 = g.add_vertex(VertexType.X)
    g.set_phase(x2, Fraction(0))
    g.set_row(x2, base_r + 1.0)
    g.set_qubit(x2, base_q + 2.0)
    g.add_edge((z2, x2), edgetype=EdgeType.SIMPLE)
    g.add_edge((z2, x2), edgetype=EdgeType.SIMPLE)
    g.add_edge((z2, x2), edgetype=EdgeType.SIMPLE)
    sc = g.add_vertex(VertexType.Z)
    g.set_phase(sc, Fraction(0))
    g.set_row(sc, base_r - 1.0)
    g.set_qubit(sc, base_q + 1.0)

def _find_zero_op_matches(g):
    pi_scalar = None
    for v in g.vertices():
        if g.type(v) == VertexType.Z and g.phase(v) % 2 == Fraction(1) and g.vertex_degree(v) == 0:
            if g.type(v) != VertexType.BOUNDARY:
                pi_scalar = v
                break
    if pi_scalar is None:
        return []
    matches = []
    for v in g.vertices():
        if v == pi_scalar:
            continue
        if g.type(v) != VertexType.Z or g.phase(v) != 0:
            continue
        if g.type(v) == VertexType.BOUNDARY:
            continue
        if g.vertex_degree(v) != 1:
            continue
        matches.append([v, pi_scalar])
    return matches

def _find_zero_op_rev_matches(g):
    pi_scalar = None
    for v in g.vertices():
        if g.type(v) == VertexType.Z and g.phase(v) % 2 == Fraction(1) and g.vertex_degree(v) == 0:
            if g.type(v) != VertexType.BOUNDARY:
                pi_scalar = v
                break
    if pi_scalar is None:
        return []
    matches = []
    for v in g.vertices():
        if v == pi_scalar:
            continue
        if g.type(v) != VertexType.X or g.phase(v) != 0:
            continue
        if g.type(v) == VertexType.BOUNDARY:
            continue
        if g.vertex_degree(v) != 1:
            continue
        matches.append([v, pi_scalar])
    return matches

def _apply_zero_op(g, match):
    g.set_type(match[0], VertexType.X)

def _apply_zero_op_rev(g, match):
    g.set_type(match[0], VertexType.Z)

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

    # BPW2020 stabilizer axioms
    if rule_name == 'b1_copy':
        return _find_b1_copy_matches(g)
    if rule_name == 'b1_uncopy':
        return _find_b1_uncopy_matches(g)
    if rule_name == 'euler_prime':
        return _find_euler_prime_matches(g)
    if rule_name == 'euler_prime_rev':
        return _find_euler_prime_rev_matches(g)
    if rule_name == 'identity_void':
        return _find_identity_void_matches(g)
    if rule_name == 'identity_void_rev':
        return [[]]
    if rule_name == 'zero_op':
        return _find_zero_op_matches(g)
    if rule_name == 'zero_op_rev':
        return _find_zero_op_rev_matches(g)

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
        unsafe_pauli_push(g, match[1], match[0])
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

    # ── BPW2020 stabilizer axioms ──
    if rule_name == 'b1_copy':
        _apply_b1_copy(g, match)
        return g.to_json()
    if rule_name == 'b1_uncopy':
        _apply_b1_uncopy(g, match)
        return g.to_json()
    if rule_name == 'euler_prime':
        _apply_euler_prime(g, match[0], match[1])
        return g.to_json()
    if rule_name == 'euler_prime_rev':
        _apply_euler_prime_rev(g, match)
        return g.to_json()
    if rule_name == 'identity_void':
        _apply_identity_void(g, match)
        return g.to_json()
    if rule_name == 'identity_void_rev':
        _apply_identity_void_rev(g, match)
        return g.to_json()
    if rule_name == 'zero_op':
        _apply_zero_op(g, match)
        return g.to_json()
    if rule_name == 'zero_op_rev':
        _apply_zero_op_rev(g, match)
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
