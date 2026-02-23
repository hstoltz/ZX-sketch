import { describe, it, expect } from 'vitest'
import { NodeType } from '../model/types.ts'
import { phase, phasesEqual } from '../model/Phase.ts'
import { createGraph, addNode, addEdge } from '../model/Graph.ts'
import { toJSONWithMap } from '../model/serialize.ts'
import { reconcileGraph } from '../model/reconcile.ts'
import { validate } from '../model/validate.ts'

describe('reconcileGraph', () => {
  it('no-op: unchanged graph preserves all nanoids and positions', () => {
    const g = createGraph()
    const b1 = addNode(g, NodeType.Boundary, 0, 0)
    const z1 = addNode(g, NodeType.Z, 100, 50, phase(1, 4))
    const b2 = addNode(g, NodeType.Boundary, 200, 0)
    addEdge(g, b1, z1)
    addEdge(g, z1, b2)
    g.inputs.push(b1)
    g.outputs.push(b2)

    const { json, nanoidToInt } = toJSONWithMap(g)

    // Feed the same JSON back as "result" — nothing changed
    const { newGraph, diff } = reconcileGraph(g, json, nanoidToInt)

    expect(diff.removedNodeIds.size).toBe(0)
    expect(diff.addedNodes.size).toBe(0)
    expect(diff.removedEdgeIds.size).toBe(0)
    expect(diff.addedEdges.size).toBe(0)
    expect(diff.survivingNodes.size).toBe(3)
    expect(diff.survivingEdges.size).toBe(2)

    // All nanoids preserved
    expect(newGraph.nodes.has(b1)).toBe(true)
    expect(newGraph.nodes.has(z1)).toBe(true)
    expect(newGraph.nodes.has(b2)).toBe(true)

    // Positions preserved
    expect(newGraph.nodes.get(z1)!.x).toBe(100)
    expect(newGraph.nodes.get(z1)!.y).toBe(50)
  })

  it('spider fusion: one node removed, survivor keeps nanoid and position', () => {
    // Two Z spiders connected by an edge → fused into one with combined phase
    const g = createGraph()
    const z1 = addNode(g, NodeType.Z, 50, 50, phase(1, 4))
    const z2 = addNode(g, NodeType.Z, 150, 50, phase(1, 4))
    addEdge(g, z1, z2)

    const { json: _before, nanoidToInt } = toJSONWithMap(g)

    // Simulate PyZX result: one Z spider with combined phase 1/2, keeping int ID 0
    const resultJson = JSON.stringify({
      version: 2,
      backend: 'simple',
      variable_types: {},
      inputs: [],
      outputs: [],
      vertices: [
        { id: 0, t: 1, pos: [50, 50], phase: '1/2' },
      ],
      edges: [],
    })

    const { newGraph, diff } = reconcileGraph(g, resultJson, nanoidToInt)

    // z1 (int 0) survives, z2 (int 1) removed
    expect(diff.survivingNodes.size).toBe(1)
    expect(diff.removedNodeIds.size).toBe(1)
    expect(diff.addedNodes.size).toBe(0)

    // Survivor keeps z1's nanoid
    expect(newGraph.nodes.has(z1)).toBe(true)
    expect(diff.removedNodeIds.has(z2)).toBe(true)

    // Survivor keeps old canvas position, but has merged phase
    const survivor = newGraph.nodes.get(z1)!
    expect(survivor.x).toBe(50)
    expect(survivor.y).toBe(50)
    expect(phasesEqual(survivor.phase, phase(1, 2))).toBe(true)
  })

  it('identity removal: degree-2 phaseless spider removed, neighbors reconnected', () => {
    // b1 — z1 — z_id — z2 — b2, where z_id is a phaseless identity spider
    const g = createGraph()
    const b1 = addNode(g, NodeType.Boundary, 0, 0)
    const z1 = addNode(g, NodeType.Z, 80, 0, phase(1, 4))
    const zId = addNode(g, NodeType.Z, 160, 0) // identity spider (degree 2, phase 0)
    const z2 = addNode(g, NodeType.Z, 240, 0, phase(1, 2))
    const b2 = addNode(g, NodeType.Boundary, 320, 0)
    addEdge(g, b1, z1)
    addEdge(g, z1, zId)
    addEdge(g, zId, z2)
    addEdge(g, z2, b2)
    g.inputs.push(b1)
    g.outputs.push(b2)

    const { json: _before, nanoidToInt } = toJSONWithMap(g)

    // PyZX removes the identity spider and connects z1 directly to z2
    // Int IDs: b1=0, z1=1, zId=2, z2=3, b2=4
    const resultJson = JSON.stringify({
      version: 2,
      backend: 'simple',
      variable_types: {},
      inputs: [0],
      outputs: [4],
      vertices: [
        { id: 0, t: 0, pos: [0, 0] },
        { id: 1, t: 1, pos: [80, 0], phase: '1/4' },
        { id: 3, t: 1, pos: [240, 0], phase: '1/2' },
        { id: 4, t: 0, pos: [320, 0] },
      ],
      edges: [[0, 1, 1], [1, 3, 1], [3, 4, 1]],
    })

    const { newGraph, diff } = reconcileGraph(g, resultJson, nanoidToInt)

    expect(diff.removedNodeIds.size).toBe(1)
    expect(diff.removedNodeIds.has(zId)).toBe(true)
    expect(diff.survivingNodes.size).toBe(4)
    expect(diff.addedNodes.size).toBe(0)

    // z1→z2 edge is new (added), replacing z1→zId and zId→z2
    expect(diff.addedEdges.size).toBe(1)
    expect(newGraph.edges.size).toBe(3)

    // Surviving nanoids preserved
    expect(newGraph.nodes.has(b1)).toBe(true)
    expect(newGraph.nodes.has(z1)).toBe(true)
    expect(newGraph.nodes.has(z2)).toBe(true)
    expect(newGraph.nodes.has(b2)).toBe(true)
  })

  it('bialgebra: old nodes removed, new nodes positioned near centroid', () => {
    // Two Z spiders → after bialgebra rewrite, replaced by different nodes
    const g = createGraph()
    const z1 = addNode(g, NodeType.Z, 100, 100)
    const z2 = addNode(g, NodeType.Z, 200, 100)
    addEdge(g, z1, z2)

    const { json: _before, nanoidToInt } = toJSONWithMap(g)

    // PyZX result: completely different nodes (new int IDs not in original)
    const resultJson = JSON.stringify({
      version: 2,
      backend: 'simple',
      variable_types: {},
      inputs: [],
      outputs: [],
      vertices: [
        { id: 10, t: 2, pos: [0, 0] },
        { id: 11, t: 2, pos: [0, 0] },
        { id: 12, t: 1, pos: [0, 0] },
      ],
      edges: [[10, 12, 1], [11, 12, 1]],
    })

    const { newGraph, diff } = reconcileGraph(g, resultJson, nanoidToInt)

    expect(diff.removedNodeIds.size).toBe(2)
    expect(diff.removedNodeIds.has(z1)).toBe(true)
    expect(diff.removedNodeIds.has(z2)).toBe(true)
    expect(diff.addedNodes.size).toBe(3)
    expect(diff.survivingNodes.size).toBe(0)

    // Added nodes should be near centroid of removed (150, 100)
    for (const node of newGraph.nodes.values()) {
      expect(Math.abs(node.x - 150)).toBeLessThan(50)
      expect(Math.abs(node.y - 100)).toBeLessThan(50)
    }
  })

  it('ID stability: two consecutive no-op reconciliations preserve nanoids', () => {
    const g = createGraph()
    const z1 = addNode(g, NodeType.Z, 50, 50, phase(1, 2))
    const z2 = addNode(g, NodeType.X, 150, 50)
    addEdge(g, z1, z2)

    // First round-trip
    const { json: json1, nanoidToInt: map1 } = toJSONWithMap(g)
    const { newGraph: g2 } = reconcileGraph(g, json1, map1)

    // Second round-trip
    const { json: json2, nanoidToInt: map2 } = toJSONWithMap(g2)
    const { newGraph: g3, diff: diff2 } = reconcileGraph(g2, json2, map2)

    // Same nanoids survive through both
    expect(diff2.survivingNodes.size).toBe(2)
    expect(diff2.removedNodeIds.size).toBe(0)
    expect(diff2.addedNodes.size).toBe(0)

    expect(g3.nodes.has(z1)).toBe(true)
    expect(g3.nodes.has(z2)).toBe(true)
  })

  it('reconciled graph passes validate()', () => {
    // Build a proper graph with boundaries
    const g = createGraph()
    const b1 = addNode(g, NodeType.Boundary, 0, 0)
    const z1 = addNode(g, NodeType.Z, 80, 0, phase(1, 4))
    const z2 = addNode(g, NodeType.Z, 160, 0)
    const b2 = addNode(g, NodeType.Boundary, 240, 0)
    addEdge(g, b1, z1)
    addEdge(g, z1, z2)
    addEdge(g, z2, b2)
    g.inputs.push(b1)
    g.outputs.push(b2)

    const { json: _before, nanoidToInt } = toJSONWithMap(g)

    // Simulate: fuse z1 and z2, keeping z1's int ID
    const resultJson = JSON.stringify({
      version: 2,
      backend: 'simple',
      variable_types: {},
      inputs: [0],
      outputs: [3],
      vertices: [
        { id: 0, t: 0, pos: [0, 0] },
        { id: 1, t: 1, pos: [80, 0], phase: '1/4' },
        { id: 3, t: 0, pos: [240, 0] },
      ],
      edges: [[0, 1, 1], [1, 3, 1]],
    })

    const { newGraph } = reconcileGraph(g, resultJson, nanoidToInt)

    const errors = validate(newGraph).filter(e => e.severity === 'error')
    expect(errors).toEqual([])
  })
})
