// ─── PyZX computation worker ───
//
// ─── Rule → PyZX Rewrite mapping (19 rules) ───
//
//   Rule                 Match                        Apply
//   ─────────────────    ───────────────────────────  ─────────────────────────────
//   spider_fusion        fuse_simp.find_all_matches   fuse_simp.apply
//   id_removal           id_simp.find_all_matches     id_simp.apply
//   bialgebra            bialg_simp.is_match⁶         bialg_simp.apply
//   copy                 copy_simp.find_all_matches   copy_simp.apply
//   color_change         color_change_rewrite.fam     color_change_rewrite.apply
//   hopf                 hopf_simp.find_all_matches   hopf_simp.apply
//   lcomp                lcomp_simp.find_all_matches  lcomp_simp.apply
//   pivot                pivot_simp.find_all_matches  pivot_simp.apply
//   self_loops           remove_self_loop_simp.fam    remove_self_loop_simp.apply
//   decompose_hadamard   euler_expansion_rewrite.fam  euler_expansion_rewrite.apply
//   wire_vertex          add_identity_rewrite.im      add_identity_rewrite.apply
//   push_pauli           check_pauli (custom iter)    _fixed_pauli_push¹
//   unfuse               (graph query)                fuse_rule.unfuse
//   pivot_boundary       match_pivot_boundary²        pivot_boundary_simp.apply
//   pivot_gadget         match_pivot_gadget²          pivot_gadget_simp.apply
//   phase_gadget_fuse    match_phase_gadgets²         gadget_simp.apply
//   supplementarity      match_supplementarity        supplementarity_simp.apply
//   bialgebra_op         match_bialgebra_op³          unsafe_bialgebra_op⁵
//   gadgetize            (graph query)                fuse_rule.unfuse (empty neighbors)⁴
//
//   ¹ Workaround for two PyZX bugs (arg swap + phase zeroed before read). See below.
//   ² Requires graph-like form. Gated by _is_graph_like() precondition check.
//   ³ PyZX provides a validator, not a discovery function. We enumerate, PyZX validates.
//   ⁴ Inverse of spider fusion: Z(α) ≡ Z(0)—Z(α). Simple edge, no ZX semantics.
//   ⁵ bialg_op_simp.apply() defaults to SIMPLE only. We try both edge types.
//   ⁶ bialg_simp.find_all_matches() uses check_bialgebra_reduce (too strict for
//     interactive use). We iterate edges with is_match (= check_bialgebra).
//
// ─── 18 simplification strategies (all native zx.simplify.*) ───
//   full_reduce, spider_simp, basic_simp, clifford_simp, to_graph_like,
//   bialg_simp, phase_free_simp, pivot_simp, pivot_gadget_simp,
//   pivot_boundary_simp, gadget_simp, lcomp_simp, supplementarity_simp,
//   to_gh, to_rg, to_clifford_normal_form, teleport_reduce,
//   interior_clifford_simp
//
// Tests: tests/test_rewrite_tensors.py (69 tensor tests),
//        tests/test_worker_integration.py (20 round-trip tests),
//        tests/fuzz_rewrites.py (~32,000 random steps, 15/19 rules)
//
// Pyodide v0.29.3 — ES module worker
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.mjs";

let pyodide = null;
let fnSimplify = null;
let fnFindMatches = null;
let fnFindAllMatches = null;
let fnApplyRewrite = null;
let fnFromQASM = null;
let fnSpiderSplit = null;

async function initPyodide() {
  self.postMessage({ type: "progress", stage: "Downloading Python runtime...", percent: 10 });

  pyodide = await loadPyodide();

  self.postMessage({ type: "progress", stage: "Installing packages...", percent: 40 });

  await pyodide.loadPackage("micropip");

  self.postMessage({ type: "progress", stage: "Installing PyZX...", percent: 50 });

  // Construct URL for bundled PyZX git HEAD wheel
  const wheelUrl = new URL('pyzx-0.9.0-py3-none-any.whl', import.meta.url).href;
  pyodide.globals.set("_wheel_url", wheelUrl);

  // Stub galois (depends on numba/LLVM, unavailable in WASM),
  // then install lark + pyzx without auto-dependency resolution
  await pyodide.runPythonAsync(`
import sys, types

# galois stub — only needed for circuit extraction, not for rewrites
_galois = types.ModuleType('galois')
_galois.__version__ = '0.0.0'
class _GF:
    def __init__(self, *a, **kw):
        raise ImportError("galois is not available in browser mode")
_galois.GF = _GF
sys.modules['galois'] = _galois

import micropip
# Install all PyZX dependencies manually (deps=False skips auto-resolution)
await micropip.install('typing-extensions')
await micropip.install('numpy')
await micropip.install('lark')
await micropip.install('tqdm')
await micropip.install('pyperclip')
# ipywidgets is optional (notebook display), skip it
_iw = types.ModuleType('ipywidgets')
sys.modules['ipywidgets'] = _iw
# Install bundled PyZX git HEAD wheel (has pyzx.rewrite_rules.* module)
await micropip.install(_wheel_url, deps=False)
  `);

  self.postMessage({ type: "progress", stage: "Initializing PyZX...", percent: 80 });

  // Define the Python API functions
  // Uses PyZX Rewrite instances from pyzx.simplify (ZXLive-style API).
  // No custom ZX rule implementations — only graph topology helpers.
  await pyodide.runPythonAsync(`
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

# ─── PyZX bug workaround: unsafe_pauli_push ───
# Verbatim copy with fix: save g.phase(w) before the mutation that zeroes it.
# Bug 1: pauli_push swaps args when calling unsafe_pauli_push.
# Bug 2: g.set_phase(w, 0) on line 96 zeroes phase before lines 101/103 read it.

def _fixed_pauli_push(g, v, w):
    """Verbatim unsafe_pauli_push with phase-read-before-zero fix."""
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
    """Find all valid reverse-bialgebra groups.
    Iterates Z-vertex PAIRS, finds COMMON X neighbors,
    validates via PyZX's match_bialgebra_op.
    Must try both SIMPLE and HADAMARD edge types."""
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

# ─── Simplify ───

def zxs_simplify(graph_json_str, strategy):
    g = zx.Graph.from_json(graph_json_str)
    # Batch strategies use add_edge_table internally, which delegates to
    # add_edge. With auto_simplify=False (set for Hopf matching), parallel
    # edges pile up instead of reducing mod 2 → tensor corruption.
    # Enable auto_simplify during batch execution, then restore False so
    # the exported graph still supports Hopf matching downstream.
    g._auto_simplify = True
    if strategy == 'full_reduce':
        zx.full_reduce(g)
    elif strategy == 'spider_simp':
        zx.simplify.spider_simp(g)
    elif strategy == 'basic_simp':
        zx.simplify.basic_simp(g)
    elif strategy == 'clifford_simp':
        zx.simplify.clifford_simp(g)
    elif strategy == 'to_graph_like':
        zx.simplify.to_graph_like(g)
    elif strategy == 'bialg_simp':
        zx.simplify.bialg_simp(g)
    elif strategy == 'phase_free_simp':
        zx.simplify.phase_free_simp(g)
    elif strategy == 'pivot_simp':
        zx.simplify.pivot_simp(g)
    elif strategy == 'pivot_gadget_simp':
        zx.simplify.pivot_gadget_simp(g)
    elif strategy == 'pivot_boundary_simp':
        zx.simplify.pivot_boundary_simp(g)
    elif strategy == 'gadget_simp':
        zx.simplify.gadget_simp(g)
    elif strategy == 'lcomp_simp':
        zx.simplify.lcomp_simp(g)
    elif strategy == 'supplementarity_simp':
        zx.simplify.supplementarity_simp(g)
    elif strategy == 'to_gh':
        zx.simplify.to_gh(g)
    elif strategy == 'to_rg':
        zx.simplify.to_rg(g)
    elif strategy == 'to_clifford_normal_form':
        zx.simplify.to_clifford_normal_form_graph(g)
    elif strategy == 'teleport_reduce':
        zx.simplify.teleport_reduce(g)
    elif strategy == 'interior_clifford_simp':
        zx.simplify.interior_clifford_simp(g)
    else:
        raise ValueError(f"Unknown strategy: {strategy}")
    g._auto_simplify = False
    return g.to_json()

# ─── Match discovery ───

def _find_matches(g, rule_name):
    """Find matches for a single rule on an already-loaded graph.
    Returns a Python list (not JSON)."""

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
        clifford_phases = {Fraction(0), Fraction(1,2), Fraction(1), Fraction(3,2)}
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

    # pivot_boundary/pivot_gadget assume graph-like form (all same-color
    # spider edges are Hadamard). Refuse entirely if graph is not graph-like.
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

    # phase_gadget_fuse: assumes graph-like form (all same-color edges Hadamard)
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

# Rules whose matchers modify the graph — they need a fresh copy each time
_GRAPH_MUTATING_RULES = {'pivot_boundary', 'pivot_gadget', 'phase_gadget_fuse'}

def zxs_find_matches(graph_json_str, rule_name):
    g = zx.Graph.from_json(graph_json_str)
    return json.dumps(_find_matches(g, rule_name))

def zxs_find_all_matches(graph_json_str, rule_names_json):
    """Find matches for ALL rules in one call.
    Loads graph once, runs each rule with per-rule error handling.
    Rules that mutate the graph during matching get a fresh copy."""
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
            print(f"[PyZX] {rule_name} match error: {e}")
            traceback.print_exc()
            results[rule_name] = []
    return json.dumps(results)

# ─── Rewrite application ───
# Table-driven rules use Rewrite.apply() which calls is_match() internally.
# Custom rules keep explicit precondition checks.

def zxs_apply_rewrite(graph_json_str, rule_name, match_json, unfuse_phase_json=''):
    g = zx.Graph.from_json(graph_json_str)
    match = json.loads(match_json)

    # Guard: check all match vertices still exist (match may be stale)
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
    # Uses _fixed_pauli_push (see bug workaround above)
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
    # pivot_boundary/pivot_gadget assume graph-like form.
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

    # phase_gadget_fuse: assumes graph-like form
    if rule_name == 'phase_gadget_fuse':
        if not _is_graph_like(g):
            return g.to_json()
        gadget_simp.apply(g, match)
        return g.to_json()

    # supplementarity
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

def zxs_spider_split(graph_json_str, node_int, phase1_n, phase1_d):
    """Split a spider into two same-color spiders connected by a simple edge."""
    g = zx.Graph.from_json(graph_json_str)
    original_phase = g.phase(node_int)
    phase1 = Fraction(phase1_n, phase1_d)
    phase2 = original_phase - phase1

    g.set_phase(node_int, phase1)

    new_v = g.add_vertex(g.type(node_int))
    g.set_row(new_v, g.row(node_int) + 1.0)
    g.set_qubit(new_v, g.qubit(node_int))
    g.set_phase(new_v, phase2)

    g.add_edge((node_int, new_v), edgetype=EdgeType.SIMPLE)

    return g.to_json()

def zxs_graph_info(graph_json_str):
    g = zx.Graph.from_json(graph_json_str)
    tc = zx.simplify.tcount(g)
    return json.dumps({
        'num_vertices': g.num_vertices(),
        'num_edges': g.num_edges(),
        'tcount': tc,
    })

# ─── QASM import ───

def zxs_from_qasm(qasm_text):
    """Convert an OpenQASM 2.0 circuit to a ZX graph and return as JSON."""
    circuit = zx.Circuit.from_qasm(qasm_text)
    graph = circuit.to_graph()
    return graph.to_json()

def zxs_compare_tensors(g1_json, g2_json):
    """Compare two graphs for semantic equality (same linear map up to scalar)."""
    g1 = zx.Graph.from_json(g1_json)
    g2 = zx.Graph.from_json(g2_json)
    return bool(zx.compare_tensors(g1, g2))
  `);

  // Get references to Python functions for efficient calling
  fnSimplify = pyodide.globals.get("zxs_simplify");
  fnFindMatches = pyodide.globals.get("zxs_find_matches");
  fnFindAllMatches = pyodide.globals.get("zxs_find_all_matches");
  fnApplyRewrite = pyodide.globals.get("zxs_apply_rewrite");
  fnFromQASM = pyodide.globals.get("zxs_from_qasm");
  fnSpiderSplit = pyodide.globals.get("zxs_spider_split");

  self.postMessage({ type: "progress", stage: "Ready", percent: 100 });
}

// --- Message handler ---

self.onmessage = async function (e) {
  const msg = e.data;

  try {
    if (msg.type === "init") {
      await initPyodide();
      self.postMessage({ id: msg.id, type: "ready" });
      return;
    }

    if (!pyodide) {
      self.postMessage({ id: msg.id, type: "error", message: "PyZX not initialized." });
      return;
    }

    switch (msg.type) {
      case "simplify": {
        const result = fnSimplify(msg.graph, msg.strategy);
        self.postMessage({ id: msg.id, type: "result", graph: result });
        break;
      }
      case "find_matches": {
        const result = fnFindMatches(msg.graph, msg.rule);
        self.postMessage({ id: msg.id, type: "matches", matches: JSON.parse(result) });
        break;
      }
      case "find_all_matches": {
        const result = fnFindAllMatches(msg.graph, JSON.stringify(msg.rules));
        self.postMessage({ id: msg.id, type: "all_matches", allMatches: JSON.parse(result) });
        break;
      }
      case "apply_rewrite": {
        const phaseJson = msg.unfusePhase ? JSON.stringify(msg.unfusePhase) : '';
        const result = fnApplyRewrite(msg.graph, msg.rule, JSON.stringify(msg.match), phaseJson);
        self.postMessage({ id: msg.id, type: "result", graph: result });
        break;
      }
      case "from_qasm": {
        const result = fnFromQASM(msg.qasm);
        self.postMessage({ id: msg.id, type: "result", graph: result });
        break;
      }
      case "spider_split": {
        const result = fnSpiderSplit(msg.graph, msg.nodeId, msg.phase1N, msg.phase1D);
        self.postMessage({ id: msg.id, type: "result", graph: result });
        break;
      }
      case "graph_info": {
        const infoFn = pyodide.globals.get("zxs_graph_info");
        const result = infoFn(msg.graph);
        self.postMessage({ id: msg.id, type: "info", info: JSON.parse(result) });
        break;
      }
      case "compare_tensors": {
        const cmpFn = pyodide.globals.get("zxs_compare_tensors");
        const result = cmpFn(msg.graph1, msg.graph2);
        self.postMessage({ id: msg.id, type: "compare_result", equal: result });
        break;
      }
      default:
        self.postMessage({ id: msg.id, type: "error", message: `Unknown message type: ${msg.type}` });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, type: "error", message: String(err) });
  }
};
