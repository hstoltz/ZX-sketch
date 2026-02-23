// Graph mutation functions.
// All functions that modify GraphData live here.

import { nanoid } from 'nanoid'
import { NodeType, EdgeType } from './types.ts'
import type { Node, Edge, Phase, GraphData } from './types.ts'
import { ZERO, addPhases } from './Phase.ts'

/** Create an empty graph. */
export function createGraph(): GraphData {
  return {
    nodes: new Map(),
    edges: new Map(),
    incidentEdges: new Map(),
    inputs: [],
    outputs: [],
  }
}

/** Deep clone a graph for undo snapshots. */
export function cloneGraph(g: GraphData): GraphData {
  const nodes = new Map<string, Node>()
  for (const [id, node] of g.nodes) {
    nodes.set(id, { ...node, phase: { ...node.phase } })
  }
  const edges = new Map<string, Edge>()
  for (const [id, edge] of g.edges) {
    edges.set(id, { ...edge })
  }
  const incidentEdges = new Map<string, Set<string>>()
  for (const [id, set] of g.incidentEdges) {
    incidentEdges.set(id, new Set(set))
  }
  return {
    nodes,
    edges,
    incidentEdges,
    inputs: [...g.inputs],
    outputs: [...g.outputs],
    scalar: g.scalar ? { ...g.scalar } : undefined,
  }
}

// --- Node operations ---

export function addNode(
  g: GraphData,
  type: NodeType,
  x: number,
  y: number,
  p: Phase = ZERO,
): string {
  const id = nanoid()
  const node: Node = { id, type, x, y, phase: { ...p } }
  g.nodes.set(id, node)
  g.incidentEdges.set(id, new Set())
  return id
}

export function removeNode(g: GraphData, id: string): void {
  const incident = g.incidentEdges.get(id)
  if (incident) {
    // Remove all incident edges
    for (const edgeId of [...incident]) {
      removeEdge(g, edgeId)
    }
  }
  g.nodes.delete(id)
  g.incidentEdges.delete(id)
  // Remove from inputs/outputs
  const inputIdx = g.inputs.indexOf(id)
  if (inputIdx !== -1) g.inputs.splice(inputIdx, 1)
  const outputIdx = g.outputs.indexOf(id)
  if (outputIdx !== -1) g.outputs.splice(outputIdx, 1)
}

export function moveNode(g: GraphData, id: string, x: number, y: number): void {
  const node = g.nodes.get(id)
  if (!node) throw new Error(`Node ${id} not found`)
  node.x = x
  node.y = y
}

export function setPhase(g: GraphData, id: string, p: Phase): void {
  const node = g.nodes.get(id)
  if (!node) throw new Error(`Node ${id} not found`)
  g.nodes.set(id, { ...node, phase: { ...p } })
}

export function setNodeType(g: GraphData, id: string, type: NodeType): void {
  const node = g.nodes.get(id)
  if (!node) throw new Error(`Node ${id} not found`)
  const degree = g.incidentEdges.get(id)?.size ?? 0
  // Boundary nodes must have arity <= 1
  if (type === NodeType.Boundary && degree > 1) {
    throw new Error(`Cannot change to Boundary: node has ${degree} edges (max 1)`)
  }
  g.nodes.set(id, { ...node, type })
}

// --- Edge operations ---

export function addEdge(
  g: GraphData,
  source: string,
  target: string,
  type: EdgeType = EdgeType.Simple,
): string {
  const sourceNode = g.nodes.get(source)
  const targetNode = g.nodes.get(target)
  if (!sourceNode) throw new Error(`Source node ${source} not found`)
  if (!targetNode) throw new Error(`Target node ${target} not found`)

  // Arity check for boundary nodes
  if (sourceNode.type === NodeType.Boundary) {
    const degree = g.incidentEdges.get(source)?.size ?? 0
    if (degree >= 1) throw new Error(`Boundary node ${source} already has an edge`)
  }
  if (targetNode.type === NodeType.Boundary && source !== target) {
    const degree = g.incidentEdges.get(target)?.size ?? 0
    if (degree >= 1) throw new Error(`Boundary node ${target} already has an edge`)
  }

  const id = nanoid()
  const edge: Edge = { id, source, target, type }
  g.edges.set(id, edge)

  // Update incidence cache
  g.incidentEdges.get(source)!.add(id)
  if (source !== target) {
    g.incidentEdges.get(target)!.add(id)
  }

  return id
}

export function removeEdge(g: GraphData, id: string): void {
  const edge = g.edges.get(id)
  if (!edge) return
  g.incidentEdges.get(edge.source)?.delete(id)
  if (edge.source !== edge.target) {
    g.incidentEdges.get(edge.target)?.delete(id)
  }
  g.edges.delete(id)
}

// --- Spider Fusion ---

/**
 * Fuse two same-color spiders.
 * - Connecting edges between s1 and s2 DISAPPEAR (they do NOT become self-loops).
 * - All other edges on s2 are rewired to s1.
 * - Phases add (mod 2pi).
 * - s1 survives (keeps its position), s2 is deleted.
 *
 * Returns the id of the surviving spider, or null if fusion was rejected.
 */
export function fuseSpiders(g: GraphData, id1: string, id2: string): string | null {
  const s1 = g.nodes.get(id1)
  const s2 = g.nodes.get(id2)
  if (!s1 || !s2) return null

  // Must be same color, and both must be Z or X (not Boundary)
  if (s1.type !== s2.type) return null
  if (s1.type !== NodeType.Z && s1.type !== NodeType.X) return null

  // Compute merged phase
  const mergedPhase = addPhases(s1.phase, s2.phase)
  g.nodes.set(id1, { ...s1, phase: mergedPhase })

  // Process all edges incident to s2
  const s2Edges = g.incidentEdges.get(id2)
  if (s2Edges) {
    for (const edgeId of [...s2Edges]) {
      const edge = g.edges.get(edgeId)
      if (!edge) continue

      const connectsS1 =
        (edge.source === id1 && edge.target === id2) ||
        (edge.source === id2 && edge.target === id1)

      if (connectsS1) {
        // Hadamard connecting edge: absorb as +π to fused spider's phase
        // (In ZX-calculus, a Hadamard self-loop on a spider adds π to its phase)
        if (edge.type === EdgeType.Hadamard) {
          const cur = g.nodes.get(id1)!
          g.nodes.set(id1, { ...cur, phase: addPhases(cur.phase, { n: 1, d: 1 }) })
        }
        // Simple connecting edges contribute scalar only (not tracked in TS)
        removeEdge(g, edgeId)
      } else if (edge.source === id2 && edge.target === id2) {
        // Self-loop on s2: rewire to self-loop on s1
        edge.source = id1
        edge.target = id1
        g.incidentEdges.get(id2)?.delete(edgeId)
        g.incidentEdges.get(id1)!.add(edgeId)
      } else if (edge.source === id2) {
        // Edge from s2 to some other node: rewire source to s1
        edge.source = id1
        g.incidentEdges.get(id2)?.delete(edgeId)
        g.incidentEdges.get(id1)!.add(edgeId)
      } else if (edge.target === id2) {
        // Edge from some other node to s2: rewire target to s1
        edge.target = id1
        g.incidentEdges.get(id2)?.delete(edgeId)
        g.incidentEdges.get(id1)!.add(edgeId)
      }
    }
  }

  // Delete s2
  g.nodes.delete(id2)
  g.incidentEdges.delete(id2)

  return id1
}

// --- Subgraph extraction & merging (copy/paste) ---

/**
 * Extract a subgraph containing the given nodes and all edges
 * whose BOTH endpoints are in the node set.
 * Returns deep-cloned nodes/edges with a centroid for paste offset.
 */
export function extractSubgraph(
  g: GraphData,
  nodeIds: Set<string>,
): { nodes: Map<string, Node>; edges: Map<string, Edge>; centroidX: number; centroidY: number } {
  const nodes = new Map<string, Node>()
  let cx = 0, cy = 0
  for (const id of nodeIds) {
    const node = g.nodes.get(id)
    if (node) {
      nodes.set(id, { ...node, phase: { ...node.phase } })
      cx += node.x
      cy += node.y
    }
  }
  const count = nodes.size || 1
  cx /= count
  cy /= count

  const edges = new Map<string, Edge>()
  for (const [edgeId, edge] of g.edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      edges.set(edgeId, { ...edge })
    }
  }

  return { nodes, edges, centroidX: cx, centroidY: cy }
}

/**
 * Merge a subgraph into the target graph.
 * Generates fresh nanoids for all nodes/edges.
 * Offsets positions relative to the given paste point.
 * Returns the set of new node IDs (for selection after paste).
 *
 * Boundary nodes from clipboard are NOT added to inputs/outputs
 * (pasting should not alter the circuit's I/O assignment).
 */
export function mergeSubgraph(
  g: GraphData,
  clipNodes: Map<string, Node>,
  clipEdges: Map<string, Edge>,
  clipCentroidX: number,
  clipCentroidY: number,
  pasteX: number,
  pasteY: number,
): { newNodeIds: Set<string>; newEdgeIds: Set<string> } {
  const oldToNew = new Map<string, string>()
  const newNodeIds = new Set<string>()
  const newEdgeIds = new Set<string>()
  const dx = pasteX - clipCentroidX
  const dy = pasteY - clipCentroidY

  for (const [oldId, node] of clipNodes) {
    const newId = nanoid()
    oldToNew.set(oldId, newId)
    const newNode: Node = {
      id: newId,
      type: node.type,
      x: node.x + dx,
      y: node.y + dy,
      phase: { ...node.phase },
    }
    g.nodes.set(newId, newNode)
    g.incidentEdges.set(newId, new Set())
    newNodeIds.add(newId)
  }

  for (const [, edge] of clipEdges) {
    const newSource = oldToNew.get(edge.source)
    const newTarget = oldToNew.get(edge.target)
    if (!newSource || !newTarget) continue
    const newId = nanoid()
    const newEdge: Edge = { id: newId, source: newSource, target: newTarget, type: edge.type }
    g.edges.set(newId, newEdge)
    g.incidentEdges.get(newSource)!.add(newId)
    if (newSource !== newTarget) {
      g.incidentEdges.get(newTarget)!.add(newId)
    }
    newEdgeIds.add(newId)
  }

  return { newNodeIds, newEdgeIds }
}

// --- Query helpers ---

/** Get the degree (number of incident edges) of a node. Self-loops count as 1. */
export function degree(g: GraphData, id: string): number {
  return g.incidentEdges.get(id)?.size ?? 0
}

/** Get all edges connecting two specific nodes. */
export function edgesBetween(g: GraphData, id1: string, id2: string): Edge[] {
  const result: Edge[] = []
  const incident = g.incidentEdges.get(id1)
  if (!incident) return result
  for (const edgeId of incident) {
    const edge = g.edges.get(edgeId)
    if (!edge) continue
    if (
      (edge.source === id1 && edge.target === id2) ||
      (edge.source === id2 && edge.target === id1)
    ) {
      result.push(edge)
    }
  }
  return result
}
