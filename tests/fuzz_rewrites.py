#!/usr/bin/env python3
"""Fuzz tester for ZX Sketch rewrite rules.

Starts from various seed diagrams, randomly applies rewrites, and verifies
tensor equality after every single step. Any mismatch is a bug.

Usage:
    python3 tests/fuzz_rewrites.py                    # default: 200 steps per seed
    python3 tests/fuzz_rewrites.py --steps 500        # more steps
    python3 tests/fuzz_rewrites.py --seed 42          # reproducible
    python3 tests/fuzz_rewrites.py --verbose           # print every step

Findings are logged to tests/fuzz_findings.md (appended).
"""

import sys
import os
import random
import json
import time
import argparse
from fractions import Fraction
from datetime import datetime

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pyzx as zx
from pyzx.utils import EdgeType, VertexType

from tests.worker_functions import (
    _find_matches, _GRAPH_MUTATING_RULES,
    zxs_apply_rewrite,
)

# ─── All 19 rule names (matching the worker) ───
ALL_RULES = [
    'spider_fusion', 'id_removal', 'bialgebra', 'copy', 'color_change',
    'hopf', 'push_pauli', 'decompose_hadamard', 'self_loops',
    'lcomp', 'pivot', 'pivot_boundary', 'pivot_gadget',
    'supplementarity', 'phase_gadget_fuse', 'unfuse', 'bialgebra_op',
    'gadgetize', 'wire_vertex',
]

# Rules that can make graphs grow unboundedly — limit how often we pick them
GROWTH_RULES = {'wire_vertex', 'decompose_hadamard', 'gadgetize', 'unfuse', 'bialgebra_op', 'color_change'}

# Max qubits for tensor comparison (O(2^n))
MAX_QUBITS = 5
MAX_VERTICES = 30


# ─── Seed diagrams ───

def make_demo_4qubit():
    """The default 4-qubit demo circuit from main.ts."""
    g = zx.Graph()
    verts = {}
    positions = [
        (0, 0, 1, 0), (1, 0, 1, 1), (2, 0, 1, 2), (3, 0, 1, 3),
        (4, 1, 2, 0), (5, 2, 2, 1), (6, 1, 2, 2), (7, 1, 2, 3),
        (8, 1, 3, 0), (9, 1, 3, 1), (10, 2, 3, 2), (11, 1, 3, 3),
        (12, 1, 4, 0), (13, 2, 4, 1), (14, 1, 4, 2), (15, 1, 4, 3),
        (16, 2, 5, 0), (17, 2, 5, 1), (18, 1, 5, 2), (19, 2, 5, 3),
        (20, 0, 6, 0), (21, 0, 6, 1), (22, 0, 6, 2), (23, 0, 6, 3),
    ]
    for vid, vt, row, qubit in positions:
        v = g.add_vertex(vt, qubit=qubit, row=row)
        verts[vid] = v

    edges = [
        (0,4,1),(1,5,1),(2,6,1),(3,7,1),(4,5,1),(4,8,1),(5,9,1),(5,10,1),
        (6,10,1),(7,11,1),(8,12,1),(9,13,2),(10,14,1),(11,15,1),(12,16,1),
        (12,17,1),(13,17,2),(13,18,2),(14,17,1),(14,18,1),(15,18,1),(15,19,1),
        (16,20,1),(17,21,1),(18,22,1),(19,23,1),
    ]
    for s, t, et in edges:
        g.add_edge((verts[s], verts[t]), EdgeType.SIMPLE if et == 1 else EdgeType.HADAMARD)

    g.set_inputs(tuple(verts[i] for i in [0,1,2,3]))
    g.set_outputs(tuple(verts[i] for i in [20,21,22,23]))
    return g, "demo_4qubit"


def make_random_circuit(qubits, depth, seed=None):
    """Generate a random circuit via PyZX."""
    rng = random.Random(seed)
    c = zx.generate.CNOT_HAD_PHASE_circuit(
        qubits=qubits, depth=depth, p_had=0.2, p_t=0.2,
    )
    g = c.to_graph()
    return g, f"random_{qubits}q_{depth}d"


def make_bell_pair():
    """Simple 1-qubit Bell-like diagram: boundary—Z—X—boundary."""
    g = zx.Graph()
    b0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
    z = g.add_vertex(VertexType.Z, qubit=0, row=1)
    x = g.add_vertex(VertexType.X, qubit=0, row=2)
    b1 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
    g.add_edge((b0, z), EdgeType.SIMPLE)
    g.add_edge((z, x), EdgeType.SIMPLE)
    g.add_edge((x, b1), EdgeType.SIMPLE)
    g.set_inputs((b0,))
    g.set_outputs((b1,))
    return g, "bell_pair"


def make_2qubit_cnot():
    """2-qubit CNOT: standard ZX representation."""
    g = zx.Graph()
    i0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
    i1 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
    z = g.add_vertex(VertexType.Z, qubit=0, row=1)
    x = g.add_vertex(VertexType.X, qubit=1, row=1)
    o0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
    o1 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=2)
    g.add_edge((i0, z), EdgeType.SIMPLE)
    g.add_edge((i1, x), EdgeType.SIMPLE)
    g.add_edge((z, x), EdgeType.SIMPLE)
    g.add_edge((z, o0), EdgeType.SIMPLE)
    g.add_edge((x, o1), EdgeType.SIMPLE)
    g.set_inputs((i0, i1))
    g.set_outputs((o0, o1))
    return g, "2qubit_cnot"


def make_3qubit_ghz_prep():
    """3-qubit GHZ state preparation."""
    c = zx.Circuit(3)
    c.add_gate("HAD", 0)
    c.add_gate("CNOT", 0, 1)
    c.add_gate("CNOT", 1, 2)
    g = c.to_graph()
    return g, "3qubit_ghz"


def make_phased_circuit():
    """2-qubit circuit with T gates (non-Clifford phases)."""
    c = zx.Circuit(2)
    c.add_gate("HAD", 0)
    c.add_gate("T", 0)
    c.add_gate("CNOT", 0, 1)
    c.add_gate("T", 1)
    c.add_gate("HAD", 1)
    c.add_gate("T", 0)
    g = c.to_graph()
    return g, "phased_2qubit"


def make_graph_like_circuit(qubits, depth, seed=None):
    """Generate a random circuit, convert to graph-like form.
    Graph-like = all same-color edges are Hadamard.
    Enables: lcomp, pivot, pivot_boundary, pivot_gadget, decompose_hadamard."""
    c = zx.generate.CNOT_HAD_PHASE_circuit(
        qubits=qubits, depth=depth, p_had=0.3, p_t=0.3,
    )
    g = c.to_graph()
    zx.simplify.to_graph_like(g)
    return g, f"graph_like_{qubits}q_{depth}d"


def make_pauli_circuit():
    """Build graph with Pauli (π-phase) spiders for push_pauli/copy/hopf.
    Has Z(π) and X(π) spiders adjacent to other spiders."""
    g = zx.Graph()
    # 2-qubit circuit with X and Z gates
    i0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
    i1 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
    z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)  # phase 0
    x1 = g.add_vertex(VertexType.X, qubit=1, row=1)  # phase π (Pauli)
    g.set_phase(x1, Fraction(1))
    z2 = g.add_vertex(VertexType.Z, qubit=0, row=2)  # phase π (Pauli)
    g.set_phase(z2, Fraction(1))
    x2 = g.add_vertex(VertexType.X, qubit=1, row=2)  # phase 0
    z3 = g.add_vertex(VertexType.Z, qubit=0, row=3)
    x3 = g.add_vertex(VertexType.X, qubit=1, row=3)
    o0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=4)
    o1 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=4)
    g.add_edge((i0, z1), EdgeType.SIMPLE)
    g.add_edge((i1, x1), EdgeType.SIMPLE)
    g.add_edge((z1, x1), EdgeType.SIMPLE)
    g.add_edge((z1, z2), EdgeType.SIMPLE)
    g.add_edge((x1, x2), EdgeType.SIMPLE)
    g.add_edge((z2, x2), EdgeType.SIMPLE)
    g.add_edge((z2, z3), EdgeType.SIMPLE)
    g.add_edge((x2, x3), EdgeType.SIMPLE)
    g.add_edge((z3, o0), EdgeType.SIMPLE)
    g.add_edge((x3, o1), EdgeType.SIMPLE)
    g.set_inputs((i0, i1))
    g.set_outputs((o0, o1))
    return g, "pauli_circuit"


def make_spider_fusion_graph():
    """Graph with adjacent same-color spiders for spider_fusion.
    Also has bialgebra-eligible structures."""
    g = zx.Graph()
    i0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
    i1 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
    z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
    g.set_phase(z1, Fraction(1, 4))
    z2 = g.add_vertex(VertexType.Z, qubit=0, row=2)
    g.set_phase(z2, Fraction(1, 4))
    x1 = g.add_vertex(VertexType.X, qubit=1, row=1)
    x2 = g.add_vertex(VertexType.X, qubit=1, row=2)
    g.set_phase(x2, Fraction(1, 2))
    o0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
    o1 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=3)
    g.add_edge((i0, z1), EdgeType.SIMPLE)
    g.add_edge((z1, z2), EdgeType.SIMPLE)  # same-color = fusible
    g.add_edge((z1, x1), EdgeType.SIMPLE)  # cross-color
    g.add_edge((z2, o0), EdgeType.SIMPLE)
    g.add_edge((i1, x1), EdgeType.SIMPLE)
    g.add_edge((x1, x2), EdgeType.SIMPLE)  # same-color = fusible
    g.add_edge((x2, o1), EdgeType.SIMPLE)
    g.set_inputs((i0, i1))
    g.set_outputs((o0, o1))
    return g, "spider_fusion_graph"


def make_bialgebra_graph():
    """Graph with Z-X bipartite structure for bialgebra/bialgebra_op.
    Two Z spiders both connected to two X spiders, all phase 0."""
    g = zx.Graph()
    i0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
    i1 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
    z1 = g.add_vertex(VertexType.Z, qubit=0, row=1)
    z2 = g.add_vertex(VertexType.Z, qubit=1, row=1)
    x1 = g.add_vertex(VertexType.X, qubit=0, row=2)
    x2 = g.add_vertex(VertexType.X, qubit=1, row=2)
    o0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
    o1 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=3)
    g.add_edge((i0, z1), EdgeType.SIMPLE)
    g.add_edge((i1, z2), EdgeType.SIMPLE)
    # bipartite: both Z connect to both X
    g.add_edge((z1, x1), EdgeType.SIMPLE)
    g.add_edge((z1, x2), EdgeType.SIMPLE)
    g.add_edge((z2, x1), EdgeType.SIMPLE)
    g.add_edge((z2, x2), EdgeType.SIMPLE)
    g.add_edge((x1, o0), EdgeType.SIMPLE)
    g.add_edge((x2, o1), EdgeType.SIMPLE)
    g.set_inputs((i0, i1))
    g.set_outputs((o0, o1))
    return g, "bialgebra_graph"


def make_graph_like_with_gadgets(qubits, depth, seed=None):
    """Graph-like form + phase gadgets. Enables: phase_gadget_fuse, pivot_gadget, copy."""
    c = zx.generate.CNOT_HAD_PHASE_circuit(
        qubits=qubits, depth=depth, p_had=0.2, p_t=0.5,  # high T-gate rate
    )
    g = c.to_graph()
    zx.simplify.to_graph_like(g)
    # Extract non-Clifford phases to gadgets
    clifford = {Fraction(0), Fraction(1, 2), Fraction(1), Fraction(3, 2)}
    gadgetized = []
    for v in list(g.vertices()):
        if g.type(v) in (VertexType.Z, VertexType.X):
            p = g.phase(v) % 2
            if p not in clifford and g.vertex_degree(v) >= 2:
                gadgetized.append(v)
    # Gadgetize manually (same as worker)
    for v in gadgetized:
        phase = g.phase(v)
        g.set_phase(v, Fraction(0))
        new_v = g.add_vertex(g.type(v))
        g.set_row(new_v, g.row(v) + 1.0)
        g.set_qubit(new_v, g.qubit(v) + 0.5)
        g.set_phase(new_v, phase)
        g.add_edge((v, new_v), edgetype=EdgeType.SIMPLE)
    return g, f"gadget_{qubits}q_{depth}d"


def make_hopf_graph():
    """Graph with parallel edges between different-color spiders for Hopf rule.
    Hopf: Z-X pair with >1 Simple edges, or same-color pair with >1 Hadamard edges."""
    g = zx.Graph()
    i0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
    z = g.add_vertex(VertexType.Z, qubit=0, row=1)
    x = g.add_vertex(VertexType.X, qubit=0, row=2)
    o0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=3)
    g.add_edge((i0, z), EdgeType.SIMPLE)
    g.add_edge((z, x), EdgeType.SIMPLE)
    g.add_edge((z, x), EdgeType.SIMPLE)  # parallel Simple edge → Hopf
    g.add_edge((x, o0), EdgeType.SIMPLE)
    g.set_inputs((i0,))
    g.set_outputs((o0,))
    return g, "hopf_graph"


def make_self_loop_graph():
    """Graph with a self-loop for self_loops rule."""
    g = zx.Graph()
    i0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
    z = g.add_vertex(VertexType.Z, qubit=0, row=1)
    o0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=2)
    g.add_edge((i0, z), EdgeType.SIMPLE)
    g.add_edge((z, z), EdgeType.HADAMARD)  # self-loop
    g.add_edge((z, o0), EdgeType.SIMPLE)
    g.set_inputs((i0,))
    g.set_outputs((o0,))
    return g, "self_loop_graph"


def make_lcomp_target():
    """Graph-like graph with Clifford π/2 spider (lcomp target).
    lcomp requires: Z type, phase ±π/2, ALL edges Hadamard, ALL neighbors Z.
    So the target must be interior (no boundary connections)."""
    g = zx.Graph()
    i0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=0)
    i1 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=0)
    i2 = g.add_vertex(VertexType.BOUNDARY, qubit=2, row=0)
    # First layer: boundary-connected Z spiders
    za = g.add_vertex(VertexType.Z, qubit=0, row=1)
    zb = g.add_vertex(VertexType.Z, qubit=1, row=1)
    zc = g.add_vertex(VertexType.Z, qubit=2, row=1)
    # Interior lcomp target: ALL edges Hadamard, ALL neighbors Z
    zt = g.add_vertex(VertexType.Z, qubit=1, row=2)
    g.set_phase(zt, Fraction(1, 2))  # π/2 → lcomp target
    # Second layer
    zd = g.add_vertex(VertexType.Z, qubit=0, row=3)
    ze = g.add_vertex(VertexType.Z, qubit=1, row=3)
    zf = g.add_vertex(VertexType.Z, qubit=2, row=3)
    o0 = g.add_vertex(VertexType.BOUNDARY, qubit=0, row=4)
    o1 = g.add_vertex(VertexType.BOUNDARY, qubit=1, row=4)
    o2 = g.add_vertex(VertexType.BOUNDARY, qubit=2, row=4)
    # Boundary → first layer (Simple)
    g.add_edge((i0, za), EdgeType.SIMPLE)
    g.add_edge((i1, zb), EdgeType.SIMPLE)
    g.add_edge((i2, zc), EdgeType.SIMPLE)
    # First layer → lcomp target (all Hadamard)
    g.add_edge((za, zt), EdgeType.HADAMARD)
    g.add_edge((zb, zt), EdgeType.HADAMARD)
    g.add_edge((zc, zt), EdgeType.HADAMARD)
    # First layer → second layer (Hadamard, for graph-like form)
    g.add_edge((za, zd), EdgeType.HADAMARD)
    g.add_edge((zb, ze), EdgeType.HADAMARD)
    g.add_edge((zc, zf), EdgeType.HADAMARD)
    # Second layer → output (Simple)
    g.add_edge((zd, o0), EdgeType.SIMPLE)
    g.add_edge((ze, o1), EdgeType.SIMPLE)
    g.add_edge((zf, o2), EdgeType.SIMPLE)
    g.set_inputs((i0, i1, i2))
    g.set_outputs((o0, o1, o2))
    return g, "lcomp_target"


# ─── Core fuzz loop ───

class FuzzStats:
    def __init__(self):
        self.steps = 0
        self.passes = 0
        self.failures = []
        self.skips = 0
        self.no_matches_streak = 0
        self.rule_counts = {}
        self.errors = []

    def record_pass(self, rule):
        self.steps += 1
        self.passes += 1
        self.rule_counts[rule] = self.rule_counts.get(rule, 0) + 1

    def record_fail(self, rule, step, seed_name, detail):
        self.steps += 1
        self.failures.append({
            'rule': rule, 'step': step, 'seed': seed_name, 'detail': detail
        })
        self.rule_counts[rule] = self.rule_counts.get(rule, 0) + 1

    def record_error(self, rule, step, seed_name, error):
        self.steps += 1
        self.errors.append({
            'rule': rule, 'step': step, 'seed': seed_name, 'error': str(error)
        })

    def record_skip(self):
        self.skips += 1


def find_all_matches(g_json):
    """Find matches for all rules on a graph. Returns dict of rule_name -> matches."""
    g = zx.Graph.from_json(g_json)
    results = {}
    for rule_name in ALL_RULES:
        try:
            if rule_name in _GRAPH_MUTATING_RULES:
                g_copy = zx.Graph.from_json(g_json)
                matches = _find_matches(g_copy, rule_name)
            else:
                matches = _find_matches(g, rule_name)
            if matches:
                results[rule_name] = matches
        except Exception:
            pass
    return results


def fuzz_one_seed(g, seed_name, max_steps, rng, stats, verbose=False):
    """Run the fuzz loop on one seed diagram."""
    g_json = g.to_json()
    qubits = max(len(g.inputs()), len(g.outputs()))

    if qubits > MAX_QUBITS:
        if verbose:
            print(f"  SKIP {seed_name}: {qubits} qubits > {MAX_QUBITS}")
        return

    step = 0
    no_match_count = 0
    consecutive_same = 0
    last_rule = None

    while step < max_steps:
        # Find all available matches
        all_matches = find_all_matches(g_json)

        if not all_matches:
            no_match_count += 1
            if no_match_count >= 3:
                if verbose:
                    print(f"  {seed_name} step {step}: no matches available x3, stopping")
                break
            continue

        no_match_count = 0

        # If stuck on one rule for 10+ steps, stop this seed (e.g., only color_change available)
        if consecutive_same >= 10 and len(all_matches) == 1:
            if verbose:
                print(f"  {seed_name} step {step}: stuck on {last_rule} (only option), stopping")
            break

        # Weight selection: strongly prefer diversity and underrepresented rules
        candidates = []
        for rule_name, matches in all_matches.items():
            # Base weight: 2 for everything
            weight = 2
            # Boost rules that haven't been tested much (globally)
            global_count = stats.rule_counts.get(rule_name, 0)
            if global_count == 0:
                weight = 20  # Strongly prefer untested rules
            elif global_count < 5:
                weight = 10
            elif global_count < 20:
                weight = 5
            # Suppress the same rule used consecutively
            if rule_name == last_rule and len(all_matches) > 1:
                weight = max(1, weight // (consecutive_same + 1))
            candidates.extend([(rule_name, matches)] * weight)

        rule_name, matches = rng.choice(candidates)
        match = rng.choice(matches)

        # Check graph size — bail if too large for tensor comparison
        g_check = zx.Graph.from_json(g_json)
        if g_check.num_vertices() > MAX_VERTICES:
            if verbose:
                print(f"  {seed_name} step {step}: graph too large ({g_check.num_vertices()} verts), stopping")
            break

        # Apply the rewrite
        try:
            result_json = zxs_apply_rewrite(g_json, rule_name, json.dumps(match))
        except Exception as e:
            stats.record_error(rule_name, step, seed_name, e)
            if verbose:
                print(f"  {seed_name} step {step}: ERROR applying {rule_name}: {e}")
            step += 1
            continue

        # Check if anything changed
        if result_json == g_json:
            # Rule was rejected (precondition guard), not a bug
            stats.record_skip()
            continue

        # Tensor comparison
        try:
            g_before = zx.Graph.from_json(g_json)
            g_after = zx.Graph.from_json(result_json)

            qubits_after = max(len(g_after.inputs()), len(g_after.outputs()))
            if qubits_after > MAX_QUBITS:
                stats.record_skip()
                if verbose:
                    print(f"  {seed_name} step {step}: {rule_name} grew to {qubits_after} qubits, skipping verify")
                g_json = result_json
                step += 1
                continue

            equal = zx.compare_tensors(g_before, g_after, preserve_scalar=False)
        except Exception as e:
            stats.record_error(rule_name, step, seed_name, e)
            if verbose:
                print(f"  {seed_name} step {step}: ERROR comparing tensors after {rule_name}: {e}")
            g_json = result_json
            step += 1
            continue

        if equal:
            stats.record_pass(rule_name)
            if verbose:
                n = zx.Graph.from_json(result_json).num_vertices()
                print(f"  {seed_name} step {step}: {rule_name} ✓ ({n} verts)")
        else:
            detail = (
                f"match={match}, "
                f"before_verts={g_before.num_vertices()}, "
                f"after_verts={g_after.num_vertices()}, "
                f"before_edges={g_before.num_edges()}, "
                f"after_edges={g_after.num_edges()}"
            )
            stats.record_fail(rule_name, step, seed_name, detail)
            print(f"\n  *** TENSOR MISMATCH ***")
            print(f"  Seed: {seed_name}, Step: {step}, Rule: {rule_name}")
            print(f"  Match: {match}")
            print(f"  Before: {g_before.num_vertices()} verts, {g_before.num_edges()} edges")
            print(f"  After:  {g_after.num_vertices()} verts, {g_after.num_edges()} edges")

            # Dump the failing graphs for investigation
            fail_dir = os.path.join(os.path.dirname(__file__), 'fuzz_failures')
            os.makedirs(fail_dir, exist_ok=True)
            ts = int(time.time())
            with open(os.path.join(fail_dir, f'{ts}_{rule_name}_before.json'), 'w') as f:
                f.write(g_json)
            with open(os.path.join(fail_dir, f'{ts}_{rule_name}_after.json'), 'w') as f:
                f.write(result_json)
            print(f"  Saved to tests/fuzz_failures/{ts}_{rule_name}_*.json")

        # Track consecutive same-rule usage
        if rule_name == last_rule:
            consecutive_same += 1
        else:
            consecutive_same = 0
        last_rule = rule_name

        g_json = result_json
        step += 1


def write_findings(stats, rng_seed, duration):
    """Append findings to tests/fuzz_findings.md."""
    findings_path = os.path.join(os.path.dirname(__file__), 'fuzz_findings.md')
    with open(findings_path, 'a') as f:
        f.write(f"\n## Fuzz run {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        f.write(f"- Seed: {rng_seed}\n")
        f.write(f"- Duration: {duration:.1f}s\n")
        f.write(f"- Steps: {stats.steps} ({stats.passes} pass, {len(stats.failures)} fail, {stats.skips} skip, {len(stats.errors)} error)\n\n")

        if stats.rule_counts:
            f.write("### Rules exercised\n\n")
            for rule, count in sorted(stats.rule_counts.items(), key=lambda x: -x[1]):
                f.write(f"- {rule}: {count}\n")
            f.write("\n")

        if stats.failures:
            f.write("### FAILURES\n\n")
            for fail in stats.failures:
                f.write(f"- **{fail['rule']}** at step {fail['step']} (seed: {fail['seed']})\n")
                f.write(f"  {fail['detail']}\n\n")

        if stats.errors:
            f.write("### ERRORS (exceptions)\n\n")
            for err in stats.errors:
                f.write(f"- **{err['rule']}** at step {err['step']} (seed: {err['seed']}): {err['error']}\n")
            f.write("\n")

        if not stats.failures and not stats.errors:
            f.write("**All clean.**\n\n")


def main():
    parser = argparse.ArgumentParser(description='Fuzz test ZX Sketch rewrite rules')
    parser.add_argument('--steps', type=int, default=200, help='Max steps per seed diagram')
    parser.add_argument('--seed', type=int, default=None, help='RNG seed for reproducibility')
    parser.add_argument('--verbose', '-v', action='store_true', help='Print every step')
    args = parser.parse_args()

    rng_seed = args.seed if args.seed is not None else random.randint(0, 2**32 - 1)
    rng = random.Random(rng_seed)
    print(f"Fuzz seed: {rng_seed}  (reproduce with --seed {rng_seed})")
    print(f"Steps per diagram: {args.steps}")
    print()

    stats = FuzzStats()
    t0 = time.time()

    # Build seed diagrams — designed to exercise ALL 19 rules.
    # Raw circuits hit: color_change, id_removal, gadgetize, unfuse, bialgebra_op
    # Graph-like circuits hit: lcomp, pivot, pivot_boundary, pivot_gadget, supplementarity, phase_gadget_fuse
    # Simple structures hit: spider_fusion, bialgebra, copy, hopf, push_pauli, decompose_hadamard, self_loops, wire_vertex
    seeds = [
        # Basic structures
        make_bell_pair(),
        make_2qubit_cnot(),
        make_3qubit_ghz_prep(),
        make_phased_circuit(),
        make_demo_4qubit(),
        # Targeted structural seeds
        make_spider_fusion_graph(),
        make_bialgebra_graph(),
        make_pauli_circuit(),
        make_hopf_graph(),
        make_self_loop_graph(),
        make_lcomp_target(),
        # Graph-like forms — enables pivot/lcomp rules
        make_graph_like_circuit(2, 15, seed=rng.randint(0, 10000)),
        make_graph_like_circuit(3, 20, seed=rng.randint(0, 10000)),
        make_graph_like_circuit(2, 30, seed=rng.randint(0, 10000)),
        # Graph-like with gadgets — enables phase_gadget_fuse, pivot_gadget, copy
        make_graph_like_with_gadgets(2, 20, seed=rng.randint(0, 10000)),
        make_graph_like_with_gadgets(3, 25, seed=rng.randint(0, 10000)),
        # Raw circuits (general coverage — keep small for speed)
        make_random_circuit(2, 10, seed=rng.randint(0, 10000)),
        make_random_circuit(2, 15, seed=rng.randint(0, 10000)),
        make_random_circuit(3, 15, seed=rng.randint(0, 10000)),
    ]

    for g, name in seeds:
        print(f"── {name} ({g.num_vertices()} verts, {g.num_edges()} edges) ──")
        fuzz_one_seed(g, name, args.steps, rng, stats, verbose=args.verbose)

    duration = time.time() - t0

    # Summary
    print()
    print(f"{'='*60}")
    print(f"  Fuzz complete in {duration:.1f}s")
    print(f"  {stats.steps} steps: {stats.passes} pass, {len(stats.failures)} FAIL, {stats.skips} skip, {len(stats.errors)} error")
    print(f"  Seed: {rng_seed}")

    if stats.rule_counts:
        print(f"\n  Rules exercised:")
        for rule, count in sorted(stats.rule_counts.items(), key=lambda x: -x[1]):
            print(f"    {rule}: {count}")

    if stats.failures:
        print(f"\n  *** {len(stats.failures)} TENSOR MISMATCHES ***")
        for fail in stats.failures:
            print(f"    {fail['rule']} at {fail['seed']} step {fail['step']}")

    if stats.errors:
        print(f"\n  {len(stats.errors)} exceptions:")
        for err in stats.errors:
            print(f"    {err['rule']} at {err['seed']} step {err['step']}: {err['error']}")

    if not stats.failures and not stats.errors:
        print(f"\n  All clean.")

    print(f"{'='*60}")

    # Write findings log
    write_findings(stats, rng_seed, duration)
    print(f"\nFindings appended to tests/fuzz_findings.md")

    return 1 if stats.failures else 0


if __name__ == '__main__':
    sys.exit(main())
