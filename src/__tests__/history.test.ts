import { describe, it, expect } from 'vitest'
import { NodeType } from '../model/types.ts'
import { phase, phasesEqual } from '../model/Phase.ts'
import { createGraph, addNode, addEdge, fuseSpiders } from '../model/Graph.ts'
import { createHistory } from '../model/History.ts'

describe('History — undo/redo', () => {
  it('starts with no undo/redo available', () => {
    const h = createHistory()
    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(false)
  })

  it('undoes a node addition', () => {
    const g = createGraph()
    const h = createHistory()

    h.save(g, 'Add Z spider')
    addNode(g, NodeType.Z, 0, 0)
    expect(g.nodes.size).toBe(1)

    h.undo(g)
    expect(g.nodes.size).toBe(0)
  })

  it('redoes after undo', () => {
    const g = createGraph()
    const h = createHistory()

    h.save(g, 'Add Z spider')
    addNode(g, NodeType.Z, 10, 20)
    expect(g.nodes.size).toBe(1)

    h.undo(g)
    expect(g.nodes.size).toBe(0)

    h.redo(g)
    expect(g.nodes.size).toBe(1)
    // The node should have the same coordinates
    const node = [...g.nodes.values()][0]
    expect(node.x).toBe(10)
    expect(node.y).toBe(20)
  })

  it('new operation clears redo stack', () => {
    const g = createGraph()
    const h = createHistory()

    h.save(g, 'Add first')
    addNode(g, NodeType.Z, 0, 0)

    h.undo(g)
    expect(h.canRedo()).toBe(true)

    // New operation
    h.save(g, 'Add second')
    addNode(g, NodeType.X, 5, 5)

    expect(h.canRedo()).toBe(false)
  })

  it('undoes multiple operations in sequence', () => {
    const g = createGraph()
    const h = createHistory()

    h.save(g, 'Add node 1')
    const a = addNode(g, NodeType.Z, 0, 0)

    h.save(g, 'Add node 2')
    const b = addNode(g, NodeType.Z, 1, 0)

    h.save(g, 'Add edge')
    addEdge(g, a, b)

    expect(g.nodes.size).toBe(2)
    expect(g.edges.size).toBe(1)

    h.undo(g) // undo edge
    expect(g.edges.size).toBe(0)
    expect(g.nodes.size).toBe(2)

    h.undo(g) // undo node 2
    expect(g.nodes.size).toBe(1)

    h.undo(g) // undo node 1
    expect(g.nodes.size).toBe(0)
  })

  it('undoes spider fusion', () => {
    const g = createGraph()
    const h = createHistory()

    const s1 = addNode(g, NodeType.Z, 0, 0, phase(1, 4))
    const s2 = addNode(g, NodeType.Z, 1, 0, phase(1, 2))
    addEdge(g, s1, s2)

    h.save(g, 'Fuse spiders')
    fuseSpiders(g, s1, s2)
    expect(g.nodes.size).toBe(1)
    expect(g.edges.size).toBe(0)

    h.undo(g)
    expect(g.nodes.size).toBe(2)
    expect(g.edges.size).toBe(1)
    expect(phasesEqual(g.nodes.get(s1)!.phase, phase(1, 4))).toBe(true)
    expect(phasesEqual(g.nodes.get(s2)!.phase, phase(1, 2))).toBe(true)
  })

  it('reports correct labels', () => {
    const g = createGraph()
    const h = createHistory()

    expect(h.undoLabel()).toBeNull()

    h.save(g, 'Add spider')
    addNode(g, NodeType.Z, 0, 0)

    expect(h.undoLabel()).toBe('Add spider')

    const label = h.undo(g)
    expect(label).toBe('Add spider')
    expect(h.redoLabel()).toBe('Add spider')
  })

  it('undo returns null when stack is empty', () => {
    const g = createGraph()
    const h = createHistory()
    expect(h.undo(g)).toBeNull()
  })

  it('clear empties both stacks', () => {
    const g = createGraph()
    const h = createHistory()

    h.save(g, 'op 1')
    addNode(g, NodeType.Z, 0, 0)
    h.undo(g)

    expect(h.canRedo()).toBe(true)

    h.clear()
    expect(h.canUndo()).toBe(false)
    expect(h.canRedo()).toBe(false)
  })
})
