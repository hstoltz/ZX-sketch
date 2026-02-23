import { describe, it, expect } from 'vitest'
import { NodeType, EdgeType } from '../model/types.ts'
import { phase, phasesEqual, isZeroPhase } from '../model/Phase.ts'
import { createGraph, addNode, addEdge } from '../model/Graph.ts'
import { toJSON, fromJSON, graphsStructurallyEqual } from '../model/serialize.ts'
import { validate } from '../model/validate.ts'

describe('PyZX JSON serialization — toJSON', () => {
  it('serializes an empty graph', () => {
    const g = createGraph()
    const json = JSON.parse(toJSON(g))
    expect(json.version).toBe(2)
    expect(json.vertices).toHaveLength(0)
    expect(json.edges).toHaveLength(0)
  })

  it('serializes nodes with correct types', () => {
    const g = createGraph()
    addNode(g, NodeType.Boundary, 0, 0)
    addNode(g, NodeType.Z, 1, 0, phase(1, 4))
    addNode(g, NodeType.X, 2, 0, phase(1, 2))

    const json = JSON.parse(toJSON(g))
    expect(json.vertices).toHaveLength(3)

    // Vertex types use 't' field (v2 format)
    const verts = json.vertices as Array<{ id: number; t: number; pos: [number, number]; phase?: string }>
    const types = verts.map(v => v.t).sort()
    expect(types).toEqual([0, 1, 2])

    // Phases are string fractions of pi
    const zVert = verts.find(v => v.t === 1)!
    expect(zVert.phase).toBe('1/4')

    const xVert = verts.find(v => v.t === 2)!
    expect(xVert.phase).toBe('1/2')

    // Boundary has no phase (or phase is 0 which is omitted)
    const bVert = verts.find(v => v.t === 0)!
    expect(bVert.phase).toBeUndefined()

    // Positions use pos array
    expect(zVert.pos).toEqual([1, 0])
  })

  it('serializes edges as tuples', () => {
    const g = createGraph()
    const a = addNode(g, NodeType.Z, 0, 0)
    const b = addNode(g, NodeType.Z, 1, 0)
    addEdge(g, a, b, EdgeType.Hadamard)

    const json = JSON.parse(toJSON(g))
    expect(json.edges).toHaveLength(1)
    const edge = json.edges[0] as [number, number, number]
    expect(edge).toHaveLength(3)
    expect(typeof edge[0]).toBe('number') // src
    expect(typeof edge[1]).toBe('number') // tgt
    expect(edge[2]).toBe(2) // Hadamard
  })

  it('vertices have sequential integer IDs', () => {
    const g = createGraph()
    addNode(g, NodeType.Z, 0, 0)
    addNode(g, NodeType.X, 1, 0)
    const json = JSON.parse(toJSON(g))
    expect(json.vertices[0].id).toBe(0)
    expect(json.vertices[1].id).toBe(1)
  })

  it('serializes inputs/outputs as integer arrays', () => {
    const g = createGraph()
    const b1 = addNode(g, NodeType.Boundary, 0, 0)
    const z = addNode(g, NodeType.Z, 1, 0)
    const b2 = addNode(g, NodeType.Boundary, 2, 0)
    addEdge(g, b1, z)
    addEdge(g, z, b2)
    g.inputs.push(b1)
    g.outputs.push(b2)

    const json = JSON.parse(toJSON(g))
    expect(json.inputs.length).toBe(1)
    expect(json.outputs.length).toBe(1)
    expect(typeof json.inputs[0]).toBe('number')
    expect(typeof json.outputs[0]).toBe('number')
  })
})

describe('PyZX JSON serialization — fromJSON', () => {
  it('parses a v2 graph', () => {
    const json = JSON.stringify({
      version: 2,
      backend: 'simple',
      variable_types: {},
      inputs: [0],
      outputs: [2],
      vertices: [
        { id: 0, t: 0, pos: [0, 0] },
        { id: 1, t: 1, pos: [1, 0], phase: '1/4' },
        { id: 2, t: 0, pos: [2, 0] },
      ],
      edges: [[0, 1, 1], [1, 2, 1]],
    })

    const g = fromJSON(json)
    expect(g.nodes.size).toBe(3)
    expect(g.edges.size).toBe(2)
    expect(g.inputs.length).toBe(1)
    expect(g.outputs.length).toBe(1)

    const zNode = [...g.nodes.values()].find(n => n.type === NodeType.Z)!
    expect(phasesEqual(zNode.phase, phase(1, 4))).toBe(true)
    expect(zNode.x).toBe(1)
    expect(zNode.y).toBe(0)
  })

  it('handles missing optional fields', () => {
    const json = JSON.stringify({
      version: 2,
      backend: 'simple',
      variable_types: {},
      inputs: [],
      outputs: [],
      vertices: [{ id: 0, t: 1, pos: [0, 0] }],
      edges: [],
    })

    const g = fromJSON(json)
    const node = [...g.nodes.values()][0]
    expect(node.x).toBe(0)
    expect(node.y).toBe(0)
    expect(isZeroPhase(node.phase)).toBe(true)
  })

  it('handles non-contiguous vertex IDs', () => {
    const json = JSON.stringify({
      version: 2,
      backend: 'simple',
      variable_types: {},
      inputs: [],
      outputs: [],
      vertices: [
        { id: 0, t: 1, pos: [0, 0] },
        { id: 5, t: 1, pos: [5, 0] },
      ],
      edges: [[0, 5, 1]],
    })

    const g = fromJSON(json)
    expect(g.nodes.size).toBe(2)
    expect(g.edges.size).toBe(1)
  })

  it('handles Hadamard edges', () => {
    const json = JSON.stringify({
      version: 2,
      backend: 'simple',
      variable_types: {},
      inputs: [],
      outputs: [],
      vertices: [
        { id: 0, t: 1, pos: [0, 0] },
        { id: 1, t: 2, pos: [1, 0] },
      ],
      edges: [[0, 1, 2]],
    })

    const g = fromJSON(json)
    const edge = [...g.edges.values()][0]
    expect(edge.type).toBe(EdgeType.Hadamard)
  })

  it('handles self-loops', () => {
    const json = JSON.stringify({
      version: 2,
      backend: 'simple',
      variable_types: {},
      inputs: [],
      outputs: [],
      vertices: [{ id: 0, t: 1, pos: [0, 0] }],
      edges: [[0, 0, 1]],
    })

    const g = fromJSON(json)
    expect(g.edges.size).toBe(1)
    const edge = [...g.edges.values()][0]
    expect(edge.source).toBe(edge.target)
  })

  it('handles missing scalar', () => {
    const json = JSON.stringify({
      version: 2,
      backend: 'simple',
      variable_types: {},
      inputs: [],
      outputs: [],
      vertices: [],
      edges: [],
    })

    const g = fromJSON(json)
    expect(g.scalar).toBeUndefined()
  })

  it('preserves scalar when present', () => {
    const json = JSON.stringify({
      version: 2,
      backend: 'simple',
      variable_types: {},
      inputs: [],
      outputs: [],
      vertices: [],
      edges: [],
      scalar: { power2: 3, phase: '1/4' },
    })

    const g = fromJSON(json)
    expect(g.scalar).toEqual({ power2: 3, phase: '1/4' })
  })

  it('throws on edge referencing nonexistent vertex', () => {
    const json = JSON.stringify({
      version: 2,
      backend: 'simple',
      variable_types: {},
      inputs: [],
      outputs: [],
      vertices: [{ id: 0, t: 1, pos: [0, 0] }],
      edges: [[0, 99, 1]],
    })

    expect(() => fromJSON(json)).toThrow(/nonexistent/)
  })
})

describe('PyZX JSON — round-trip', () => {
  it('empty graph round-trips', () => {
    const g = createGraph()
    const imported = fromJSON(toJSON(g))
    expect(graphsStructurallyEqual(g, imported)).toBe(true)
  })

  it('simple graph round-trips', () => {
    const g = createGraph()
    const b1 = addNode(g, NodeType.Boundary, 0, 0)
    const z = addNode(g, NodeType.Z, 1, 0, phase(3, 4))
    const b2 = addNode(g, NodeType.Boundary, 2, 0)
    addEdge(g, b1, z)
    addEdge(g, z, b2, EdgeType.Hadamard)
    g.inputs.push(b1)
    g.outputs.push(b2)

    const imported = fromJSON(toJSON(g))
    expect(graphsStructurallyEqual(g, imported)).toBe(true)
  })

  it('graph with multi-edges and self-loops round-trips', () => {
    const g = createGraph()
    const a = addNode(g, NodeType.Z, 0, 0)
    const b = addNode(g, NodeType.Z, 1, 0)
    addEdge(g, a, b)
    addEdge(g, a, b) // multi-edge
    addEdge(g, a, a) // self-loop

    const imported = fromJSON(toJSON(g))
    expect(imported.nodes.size).toBe(2)
    expect(imported.edges.size).toBe(3)
  })

  it('X spider with phase round-trips', () => {
    const g = createGraph()
    addNode(g, NodeType.X, 5, 10, phase(7, 4))

    const imported = fromJSON(toJSON(g))
    const node = [...imported.nodes.values()][0]
    expect(node.type).toBe(NodeType.X)
    expect(node.x).toBe(5)
    expect(node.y).toBe(10)
    expect(phasesEqual(node.phase, phase(7, 4))).toBe(true)
  })
})

describe('Validation', () => {
  it('valid empty graph has no errors', () => {
    const g = createGraph()
    expect(validate(g)).toEqual([])
  })

  it('valid graph with boundary nodes has no errors', () => {
    const g = createGraph()
    const b1 = addNode(g, NodeType.Boundary, 0, 0)
    const z = addNode(g, NodeType.Z, 1, 0)
    const b2 = addNode(g, NodeType.Boundary, 2, 0)
    addEdge(g, b1, z)
    addEdge(g, z, b2)
    g.inputs.push(b1)
    g.outputs.push(b2)

    const errors = validate(g)
    expect(errors.filter(e => e.severity === 'error')).toEqual([])
  })

  it('warns on disconnected boundary node', () => {
    const g = createGraph()
    addNode(g, NodeType.Boundary, 0, 0)

    const errors = validate(g)
    expect(errors.some(e => e.severity === 'warning' && e.message.includes('no edge'))).toBe(true)
  })

  it('errors on node in both inputs and outputs', () => {
    const g = createGraph()
    const b = addNode(g, NodeType.Boundary, 0, 0)
    const z = addNode(g, NodeType.Z, 1, 0)
    addEdge(g, b, z)
    g.inputs.push(b)
    g.outputs.push(b)

    const errors = validate(g)
    expect(errors.some(e => e.severity === 'error' && e.message.includes('both inputs and outputs'))).toBe(true)
  })

  it('arity-0 spider is valid (no errors)', () => {
    const g = createGraph()
    addNode(g, NodeType.Z, 0, 0, phase(1, 4))

    const errors = validate(g)
    expect(errors.filter(e => e.severity === 'error')).toEqual([])
  })
})
