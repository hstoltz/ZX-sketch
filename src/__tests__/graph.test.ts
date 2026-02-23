import { describe, it, expect } from 'vitest'
import { NodeType, EdgeType } from '../model/types.ts'
import { phase, phasesEqual, isZeroPhase } from '../model/Phase.ts'
import {
  createGraph, cloneGraph,
  addNode, removeNode, moveNode, setPhase, setNodeType,
  addEdge, removeEdge,
  fuseSpiders, degree, edgesBetween,
  extractSubgraph, mergeSubgraph,
} from '../model/Graph.ts'

describe('Graph — node operations', () => {
  it('creates an empty graph', () => {
    const g = createGraph()
    expect(g.nodes.size).toBe(0)
    expect(g.edges.size).toBe(0)
  })

  it('adds a node', () => {
    const g = createGraph()
    const id = addNode(g, NodeType.Z, 10, 20)
    expect(g.nodes.size).toBe(1)
    const node = g.nodes.get(id)!
    expect(node.type).toBe(NodeType.Z)
    expect(node.x).toBe(10)
    expect(node.y).toBe(20)
    expect(isZeroPhase(node.phase)).toBe(true)
  })

  it('adds a node with phase', () => {
    const g = createGraph()
    const id = addNode(g, NodeType.X, 0, 0, phase(3, 4))
    const node = g.nodes.get(id)!
    expect(phasesEqual(node.phase, phase(3, 4))).toBe(true)
  })

  it('removes a node and its incident edges', () => {
    const g = createGraph()
    const a = addNode(g, NodeType.Z, 0, 0)
    const b = addNode(g, NodeType.Z, 1, 0)
    addEdge(g, a, b)
    expect(g.edges.size).toBe(1)

    removeNode(g, a)
    expect(g.nodes.size).toBe(1)
    expect(g.edges.size).toBe(0)
  })

  it('removes boundary node from inputs/outputs', () => {
    const g = createGraph()
    const b = addNode(g, NodeType.Boundary, 0, 0)
    g.inputs.push(b)
    expect(g.inputs).toContain(b)

    removeNode(g, b)
    expect(g.inputs).not.toContain(b)
  })

  it('moves a node', () => {
    const g = createGraph()
    const id = addNode(g, NodeType.Z, 0, 0)
    moveNode(g, id, 50, 100)
    const node = g.nodes.get(id)!
    expect(node.x).toBe(50)
    expect(node.y).toBe(100)
  })

  it('sets node phase', () => {
    const g = createGraph()
    const id = addNode(g, NodeType.Z, 0, 0)
    setPhase(g, id, phase(1, 2))
    expect(phasesEqual(g.nodes.get(id)!.phase, phase(1, 2))).toBe(true)
  })

  it('toggles node type Z↔X', () => {
    const g = createGraph()
    const id = addNode(g, NodeType.Z, 0, 0)
    setNodeType(g, id, NodeType.X)
    expect(g.nodes.get(id)!.type).toBe(NodeType.X)
  })

  it('rejects changing to Boundary if degree > 1', () => {
    const g = createGraph()
    const a = addNode(g, NodeType.Z, 0, 0)
    const b = addNode(g, NodeType.Z, 1, 0)
    const c = addNode(g, NodeType.Z, 2, 0)
    addEdge(g, a, b)
    addEdge(g, a, c)
    expect(() => setNodeType(g, a, NodeType.Boundary)).toThrow()
  })
})

describe('Graph — edge operations', () => {
  it('adds an edge', () => {
    const g = createGraph()
    const a = addNode(g, NodeType.Z, 0, 0)
    const b = addNode(g, NodeType.Z, 1, 0)
    const eid = addEdge(g, a, b)
    expect(g.edges.size).toBe(1)
    expect(g.edges.get(eid)!.source).toBe(a)
    expect(g.edges.get(eid)!.target).toBe(b)
    expect(g.edges.get(eid)!.type).toBe(EdgeType.Simple)
  })

  it('adds a Hadamard edge', () => {
    const g = createGraph()
    const a = addNode(g, NodeType.Z, 0, 0)
    const b = addNode(g, NodeType.X, 1, 0)
    const eid = addEdge(g, a, b, EdgeType.Hadamard)
    expect(g.edges.get(eid)!.type).toBe(EdgeType.Hadamard)
  })

  it('allows multi-edges between spiders', () => {
    const g = createGraph()
    const a = addNode(g, NodeType.Z, 0, 0)
    const b = addNode(g, NodeType.Z, 1, 0)
    addEdge(g, a, b)
    addEdge(g, a, b)
    addEdge(g, a, b)
    expect(g.edges.size).toBe(3)
    expect(degree(g, a)).toBe(3)
  })

  it('allows self-loops on spiders', () => {
    const g = createGraph()
    const a = addNode(g, NodeType.Z, 0, 0)
    addEdge(g, a, a)
    expect(g.edges.size).toBe(1)
    expect(degree(g, a)).toBe(1)
  })

  it('rejects second edge on boundary node', () => {
    const g = createGraph()
    const b = addNode(g, NodeType.Boundary, 0, 0)
    const z = addNode(g, NodeType.Z, 1, 0)
    const z2 = addNode(g, NodeType.Z, 2, 0)
    addEdge(g, b, z)
    expect(() => addEdge(g, b, z2)).toThrow()
  })

  it('removes an edge and updates incidence', () => {
    const g = createGraph()
    const a = addNode(g, NodeType.Z, 0, 0)
    const b = addNode(g, NodeType.Z, 1, 0)
    const eid = addEdge(g, a, b)
    removeEdge(g, eid)
    expect(g.edges.size).toBe(0)
    expect(degree(g, a)).toBe(0)
    expect(degree(g, b)).toBe(0)
  })

  it('edgesBetween finds connecting edges', () => {
    const g = createGraph()
    const a = addNode(g, NodeType.Z, 0, 0)
    const b = addNode(g, NodeType.Z, 1, 0)
    const c = addNode(g, NodeType.Z, 2, 0)
    addEdge(g, a, b)
    addEdge(g, a, b)
    addEdge(g, a, c)
    expect(edgesBetween(g, a, b).length).toBe(2)
    expect(edgesBetween(g, a, c).length).toBe(1)
    expect(edgesBetween(g, b, c).length).toBe(0)
  })
})

describe('Graph — cloneGraph', () => {
  it('produces an independent copy', () => {
    const g = createGraph()
    const a = addNode(g, NodeType.Z, 0, 0, phase(1, 4))
    const b = addNode(g, NodeType.Z, 1, 0)
    addEdge(g, a, b)

    const clone = cloneGraph(g)
    // Same structure
    expect(clone.nodes.size).toBe(2)
    expect(clone.edges.size).toBe(1)

    // Mutating original doesn't affect clone
    moveNode(g, a, 999, 999)
    expect(clone.nodes.get(a)!.x).toBe(0)
  })
})

describe('Spider Fusion', () => {
  it('1. fuses Z(0) + Z(0) — connecting edge disappears', () => {
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0)
    const s2 = addNode(g, NodeType.Z, 1, 0)
    addEdge(g, s1, s2)

    const result = fuseSpiders(g, s1, s2)
    expect(result).toBe(s1)
    expect(g.nodes.size).toBe(1)
    expect(g.edges.size).toBe(0)
    expect(isZeroPhase(g.nodes.get(s1)!.phase)).toBe(true)
  })

  it('2. fuses Z(pi/4) + Z(pi/2) → Z(3pi/4)', () => {
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0, phase(1, 4))
    const s2 = addNode(g, NodeType.Z, 1, 0, phase(1, 2))
    addEdge(g, s1, s2)

    fuseSpiders(g, s1, s2)
    expect(phasesEqual(g.nodes.get(s1)!.phase, phase(3, 4))).toBe(true)
    expect(g.edges.size).toBe(0)
  })

  it('3. three parallel edges between them → all 3 vanish', () => {
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0)
    const s2 = addNode(g, NodeType.Z, 1, 0)
    addEdge(g, s1, s2)
    addEdge(g, s1, s2)
    addEdge(g, s2, s1) // reverse direction — still connects them

    fuseSpiders(g, s1, s2)
    expect(g.edges.size).toBe(0)
    expect(g.nodes.size).toBe(1)
  })

  it('4. Z(pi) + Z(pi) → Z(0) — phases wrap mod 2', () => {
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0, phase(1))
    const s2 = addNode(g, NodeType.Z, 1, 0, phase(1))
    addEdge(g, s1, s2)

    fuseSpiders(g, s1, s2)
    expect(isZeroPhase(g.nodes.get(s1)!.phase)).toBe(true)
  })

  it('5. self-loop on s1 preserved after fusion', () => {
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0)
    const s2 = addNode(g, NodeType.Z, 1, 0)
    addEdge(g, s1, s1) // self-loop on s1
    addEdge(g, s1, s2) // connecting edge

    fuseSpiders(g, s1, s2)
    expect(g.nodes.size).toBe(1)
    expect(g.edges.size).toBe(1)
    // Remaining edge should be the self-loop
    const remaining = [...g.edges.values()][0]
    expect(remaining.source).toBe(s1)
    expect(remaining.target).toBe(s1)
  })

  it('6. both connected to same third node → multi-edge', () => {
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0)
    const s2 = addNode(g, NodeType.Z, 1, 0)
    const n = addNode(g, NodeType.Z, 2, 0)
    addEdge(g, s1, s2) // connecting edge
    addEdge(g, s1, n)  // s1 → N
    addEdge(g, s2, n)  // s2 → N

    fuseSpiders(g, s1, s2)
    expect(g.nodes.size).toBe(2)
    // Connecting edge gone, two edges to N remain
    expect(g.edges.size).toBe(2)
    expect(edgesBetween(g, s1, n).length).toBe(2)
  })

  it('7. self-loop on s2 preserved, connecting edge vanishes', () => {
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0)
    const s2 = addNode(g, NodeType.Z, 1, 0)
    addEdge(g, s1, s2)  // connecting edge
    addEdge(g, s2, s2)  // self-loop on s2

    fuseSpiders(g, s1, s2)
    expect(g.nodes.size).toBe(1)
    expect(g.edges.size).toBe(1)
    // Self-loop should now be on s1
    const remaining = [...g.edges.values()][0]
    expect(remaining.source).toBe(s1)
    expect(remaining.target).toBe(s1)
  })

  it('8. Z + X → rejected', () => {
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0)
    const s2 = addNode(g, NodeType.X, 1, 0)
    addEdge(g, s1, s2)

    const result = fuseSpiders(g, s1, s2)
    expect(result).toBeNull()
    // Graph unchanged
    expect(g.nodes.size).toBe(2)
    expect(g.edges.size).toBe(1)
  })

  it('9. Boundary + Boundary → rejected', () => {
    const g = createGraph()
    const b1 = addNode(g, NodeType.Boundary, 0, 0)
    const b2 = addNode(g, NodeType.Boundary, 1, 0)

    const result = fuseSpiders(g, b1, b2)
    expect(result).toBeNull()
  })

  it('fuses two arity-0 spiders (no edges, just phases)', () => {
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0, phase(1, 4))
    const s2 = addNode(g, NodeType.Z, 1, 0, phase(1, 2))

    fuseSpiders(g, s1, s2)
    expect(g.nodes.size).toBe(1)
    expect(g.edges.size).toBe(0)
    expect(phasesEqual(g.nodes.get(s1)!.phase, phase(3, 4))).toBe(true)
  })

  it('X + X fusion works the same as Z + Z', () => {
    const g = createGraph()
    const s1 = addNode(g, NodeType.X, 0, 0, phase(1, 3))
    const s2 = addNode(g, NodeType.X, 1, 0, phase(1, 3))
    addEdge(g, s1, s2)

    fuseSpiders(g, s1, s2)
    expect(g.nodes.size).toBe(1)
    expect(g.edges.size).toBe(0)
    expect(phasesEqual(g.nodes.get(s1)!.phase, phase(2, 3))).toBe(true)
  })

  it('Hadamard connecting edge absorbs +pi phase on fusion', () => {
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0, phase(1, 4))
    const s2 = addNode(g, NodeType.Z, 1, 0, phase(1, 4))
    addEdge(g, s1, s2, EdgeType.Hadamard) // Hadamard connecting edge

    fuseSpiders(g, s1, s2)
    expect(g.nodes.size).toBe(1)
    expect(g.edges.size).toBe(0)
    // 1/4 + 1/4 + 1 (from H self-loop absorption) = 3/2
    expect(phasesEqual(g.nodes.get(s1)!.phase, phase(3, 2))).toBe(true)
  })

  it('mixed connecting edges: simple removed, Hadamard absorbs pi', () => {
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0)
    const s2 = addNode(g, NodeType.Z, 1, 0)
    addEdge(g, s1, s2, EdgeType.Simple)    // simple: just removed
    addEdge(g, s1, s2, EdgeType.Hadamard)  // Hadamard: absorbs +pi

    fuseSpiders(g, s1, s2)
    expect(g.nodes.size).toBe(1)
    expect(g.edges.size).toBe(0)
    // 0 + 0 + 1 (from H edge) = pi
    expect(phasesEqual(g.nodes.get(s1)!.phase, phase(1))).toBe(true)
  })
})

// Cross-validation: verify TS fuseSpiders produces structurally identical
// results to what PyZX would produce. The tensor tests in
// tests/test_rewrite_tensors.py::TestSpiderFusionPyZX verify PyZX's side;
// these tests verify the TS side matches.
describe('Spider Fusion — PyZX cross-validation', () => {
  it('Z(π/4) + Z(π/2) → Z(3π/4), 0 edges (matches PyZX)', () => {
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0, phase(1, 4))
    const s2 = addNode(g, NodeType.Z, 1, 0, phase(1, 2))
    addEdge(g, s1, s2)

    fuseSpiders(g, s1, s2)
    // PyZX: check_fuse(g, s1, s2) + unsafe_fuse → 1 node, phase 3/4
    expect(g.nodes.size).toBe(1)
    expect(g.edges.size).toBe(0)
    expect(phasesEqual(g.nodes.get(s1)!.phase, phase(3, 4))).toBe(true)
  })

  it('fuse with external neighbors → multi-edge preserved (matches PyZX)', () => {
    // After fusion, both external edges should point to the surviving node
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0)
    const s2 = addNode(g, NodeType.Z, 1, 0)
    const n = addNode(g, NodeType.Z, 2, 0)
    addEdge(g, s1, s2)
    addEdge(g, s1, n)
    addEdge(g, s2, n)

    fuseSpiders(g, s1, s2)
    // PyZX: 2 nodes, 2 edges (both to n), connecting edge removed
    expect(g.nodes.size).toBe(2)
    expect(g.edges.size).toBe(2)
    expect(edgesBetween(g, s1, n).length).toBe(2)
  })

  it('Hadamard connecting edge → +π absorbed (matches PyZX self-loop semantics)', () => {
    // TS absorbs H connecting edge as +π; PyZX would create an H self-loop
    // then absorb it. Both produce the same final phase.
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0, phase(1, 4))
    const s2 = addNode(g, NodeType.Z, 1, 0, phase(1, 4))
    addEdge(g, s1, s2, EdgeType.Hadamard)

    fuseSpiders(g, s1, s2)
    // PyZX: fuse → H self-loop on merged node → absorbed as +π
    // Net phase: 1/4 + 1/4 + 1 = 3/2
    expect(g.nodes.size).toBe(1)
    expect(g.edges.size).toBe(0)
    expect(phasesEqual(g.nodes.get(s1)!.phase, phase(3, 2))).toBe(true)
  })

  it('self-loop on absorbed spider transferred (matches PyZX)', () => {
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0)
    const s2 = addNode(g, NodeType.Z, 1, 0)
    addEdge(g, s1, s2)
    addEdge(g, s2, s2)  // self-loop on s2 (absorbed spider)

    fuseSpiders(g, s1, s2)
    // PyZX: self-loop on s2 becomes self-loop on merged node
    expect(g.nodes.size).toBe(1)
    expect(g.edges.size).toBe(1)
    const remaining = [...g.edges.values()][0]
    expect(remaining.source).toBe(s1)
    expect(remaining.target).toBe(s1)
  })

  it('multiple connecting edges of mixed types (matches PyZX)', () => {
    // 2 simple + 1 Hadamard connecting edges
    const g = createGraph()
    const s1 = addNode(g, NodeType.Z, 0, 0)
    const s2 = addNode(g, NodeType.Z, 1, 0)
    addEdge(g, s1, s2, EdgeType.Simple)
    addEdge(g, s1, s2, EdgeType.Simple)
    addEdge(g, s1, s2, EdgeType.Hadamard)

    fuseSpiders(g, s1, s2)
    // All connecting edges removed, H edge adds +π
    expect(g.nodes.size).toBe(1)
    expect(g.edges.size).toBe(0)
    expect(phasesEqual(g.nodes.get(s1)!.phase, phase(1))).toBe(true)
  })
})

describe('Copy/Paste — extractSubgraph & mergeSubgraph', () => {
  it('extracts selected nodes and internal edges', () => {
    const g = createGraph()
    const a = addNode(g, NodeType.Z, 0, 0)
    const b = addNode(g, NodeType.Z, 100, 0)
    const c = addNode(g, NodeType.Z, 200, 0)
    const eAB = addEdge(g, a, b)
    addEdge(g, b, c) // not selected — c is outside

    const sub = extractSubgraph(g, new Set([a, b]))
    expect(sub.nodes.size).toBe(2)
    expect(sub.edges.size).toBe(1) // only a-b edge
    expect(sub.edges.has(eAB)).toBe(true)
    expect(sub.centroidX).toBe(50)
    expect(sub.centroidY).toBe(0)
  })

  it('excludes edges with one endpoint outside selection', () => {
    const g = createGraph()
    const a = addNode(g, NodeType.Z, 0, 0)
    const b = addNode(g, NodeType.Z, 100, 0)
    addEdge(g, a, b)

    const sub = extractSubgraph(g, new Set([a]))
    expect(sub.nodes.size).toBe(1)
    expect(sub.edges.size).toBe(0)
  })

  it('merges subgraph with fresh IDs and offset', () => {
    const g = createGraph()
    const existing = addNode(g, NodeType.X, 500, 500)

    const clipNodes = new Map([
      ['old1', { id: 'old1', type: NodeType.Z, x: 0, y: 0, phase: { n: 1, d: 4 } }],
      ['old2', { id: 'old2', type: NodeType.Z, x: 100, y: 0, phase: { n: 0, d: 1 } }],
    ])
    const clipEdges = new Map([
      ['oldE', { id: 'oldE', source: 'old1', target: 'old2', type: EdgeType.Simple }],
    ])

    const { newNodeIds, newEdgeIds } = mergeSubgraph(
      g, clipNodes, clipEdges, 50, 0, 90, 40,
    )

    expect(newNodeIds.size).toBe(2)
    expect(newEdgeIds.size).toBe(1)
    // Fresh IDs — old IDs not in graph
    expect(g.nodes.has('old1')).toBe(false)
    expect(g.nodes.has('old2')).toBe(false)
    // Original node still there
    expect(g.nodes.has(existing)).toBe(true)
    // Total: 3 nodes, 1 edge
    expect(g.nodes.size).toBe(3)
    expect(g.edges.size).toBe(1)

    // Check offset: dx=40, dy=40
    for (const id of newNodeIds) {
      const node = g.nodes.get(id)!
      // Original positions were 0,0 and 100,0
      // Offset by (90-50, 40-0) = (40, 40)
      expect(node.x === 40 || node.x === 140).toBe(true)
      expect(node.y).toBe(40)
    }

    // Edge endpoints should reference new IDs
    for (const eid of newEdgeIds) {
      const edge = g.edges.get(eid)!
      expect(newNodeIds.has(edge.source)).toBe(true)
      expect(newNodeIds.has(edge.target)).toBe(true)
    }
  })

  it('preserves self-loops in subgraph', () => {
    const g = createGraph()
    const a = addNode(g, NodeType.Z, 0, 0)
    const selfLoop = addEdge(g, a, a)

    const sub = extractSubgraph(g, new Set([a]))
    expect(sub.edges.size).toBe(1)
    expect(sub.edges.has(selfLoop)).toBe(true)
  })

  it('merge does not add boundary nodes to inputs/outputs', () => {
    const g = createGraph()
    const clipNodes = new Map([
      ['b1', { id: 'b1', type: NodeType.Boundary, x: 0, y: 0, phase: { n: 0, d: 1 } }],
    ])

    mergeSubgraph(g, clipNodes, new Map(), 0, 0, 40, 40)

    expect(g.inputs.length).toBe(0)
    expect(g.outputs.length).toBe(0)
  })
})
