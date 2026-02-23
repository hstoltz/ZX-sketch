// Reconciliation: map PyZX worker results back to app graph nanoids.

import { nanoid } from 'nanoid'
import { NodeType, EdgeType } from './types.ts'
import type { Node, Edge, GraphData } from './types.ts'
import { phaseFromJsonString, ZERO } from './Phase.ts'

// --- PyZX v2 JSON types (duplicated minimally to avoid circular deps) ---

interface PyZXV2Vertex {
  id: number
  t: number
  pos: [number, number]
  phase?: string
  ground?: boolean
}

interface PyZXV2Json {
  version: 2
  backend: string
  variable_types: Record<string, never>
  scalar?: { power2: number; phase: string }
  inputs: number[]
  outputs: number[]
  vertices: PyZXV2Vertex[]
  edges: [number, number, number][]
}

// --- Public types ---

export interface GraphDiff {
  survivingNodes: Map<string, Node>
  removedNodeIds: Set<string>
  addedNodes: Map<string, Node>
  survivingEdges: Map<string, Edge>
  removedEdgeIds: Set<string>
  addedEdges: Map<string, Edge>
}

export interface ReconcileResult {
  newGraph: GraphData
  diff: GraphDiff
}

/**
 * Reconcile a PyZX result JSON against the original graph, preserving nanoid
 * identity for nodes/edges that survived the rewrite.
 *
 * @param oldGraph    The graph before simplification
 * @param newJsonStr  The PyZX v2 JSON string after simplification
 * @param nanoidToInt The nanoid→int mapping from the original export
 */
export function reconcileGraph(
  oldGraph: GraphData,
  newJsonStr: string,
  nanoidToInt: Map<string, number>,
): ReconcileResult {
  const json: PyZXV2Json = JSON.parse(newJsonStr)

  // 1. Build reverse map: int→nanoid
  const intToNanoid = new Map<number, string>()
  for (const [nid, intId] of nanoidToInt) {
    intToNanoid.set(intId, nid)
  }

  // 2. Process vertices — match surviving, identify added
  const newIntToNanoid = new Map<number, string>() // maps result int IDs → nanoids (new or reused)
  const survivingNodes = new Map<string, Node>()
  const survivingPyZXPos = new Map<string, [number, number]>()
  const addedNodes = new Map<string, Node>()
  const survivingIntIds = new Set<number>()

  for (const v of json.vertices) {
    const existingNanoid = intToNanoid.get(v.id)
    const phase = v.phase ? phaseFromJsonString(v.phase) : ZERO

    if (existingNanoid && oldGraph.nodes.has(existingNanoid)) {
      // Surviving node: reuse nanoid, take new type/phase.
      // Store both old canvas position and PyZX circuit-space position;
      // we'll decide which to use in step 4 after we know if there are added nodes.
      const oldNode = oldGraph.nodes.get(existingNanoid)!
      const node: Node = {
        id: existingNanoid,
        type: v.t as NodeType,
        x: oldNode.x,
        y: oldNode.y,
        phase,
        ground: v.ground || undefined,
      }
      survivingNodes.set(existingNanoid, node)
      survivingPyZXPos.set(existingNanoid, v.pos)
      newIntToNanoid.set(v.id, existingNanoid)
      survivingIntIds.add(v.id)
    } else {
      // Added node: fresh nanoid
      const id = nanoid()
      const node: Node = {
        id,
        type: v.t as NodeType,
        x: v.pos[0],
        y: v.pos[1],
        phase,
        ground: v.ground || undefined,
      }
      addedNodes.set(id, node)
      newIntToNanoid.set(v.id, id)
    }
  }

  // 3. Identify removed nodes
  const removedNodeIds = new Set<string>()
  for (const [nid, intId] of nanoidToInt) {
    if (!survivingIntIds.has(intId)) {
      removedNodeIds.add(nid)
    }
  }

  // Position nodes using PyZX's circuit-space layout (scaled to canvas).
  const GRID_SCALE = 80

  if (addedNodes.size > 0) {
    // Structural change: reposition all nodes from PyZX layout.

    // Update surviving nodes to PyZX's positions (scaled)
    for (const [nodeId, node] of survivingNodes) {
      const pyzxPos = survivingPyZXPos.get(nodeId)
      if (pyzxPos) {
        node.x = pyzxPos[0] * GRID_SCALE
        node.y = pyzxPos[1] * GRID_SCALE
      }
    }

    // Scale added nodes from circuit-space to canvas-space
    for (const node of addedNodes.values()) {
      node.x = node.x * GRID_SCALE
      node.y = node.y * GRID_SCALE
    }

    // Fallback: if all added nodes are at the same point (PyZX returned
    // all-zero or identical positions), spread near centroid of removed nodes.
    let allSamePoint = true
    const first = addedNodes.values().next().value!
    for (const node of addedNodes.values()) {
      if (node.x !== first.x || node.y !== first.y) {
        allSamePoint = false
        break
      }
    }

    if (allSamePoint && removedNodeIds.size > 0) {
      // Revert surviving nodes to old canvas positions (degenerate layout)
      for (const [nodeId, node] of survivingNodes) {
        const oldNode = oldGraph.nodes.get(nodeId)
        if (oldNode) { node.x = oldNode.x; node.y = oldNode.y }
      }
      let cx = 0, cy = 0, count = 0
      for (const nid of removedNodeIds) {
        const node = oldGraph.nodes.get(nid)
        if (node) { cx += node.x; cy += node.y; count++ }
      }
      if (count > 0) {
        cx /= count; cy /= count
        const JITTER_RADIUS = 30
        let i = 0
        for (const node of addedNodes.values()) {
          const angle = (2 * Math.PI * i) / addedNodes.size
          node.x = cx + JITTER_RADIUS * Math.cos(angle)
          node.y = cy + JITTER_RADIUS * Math.sin(angle)
          i++
        }
      }
    }
  }

  // 5. Match edges
  // Build a key for old edges: "min(srcInt,tgtInt):max(srcInt,tgtInt):type"
  // Use a multimap since there can be parallel edges
  const oldEdgesByKey = new Map<string, string[]>() // key → [edgeNanoid, ...]
  for (const [edgeId, edge] of oldGraph.edges) {
    const srcInt = nanoidToInt.get(edge.source)
    const tgtInt = nanoidToInt.get(edge.target)
    if (srcInt === undefined || tgtInt === undefined) continue
    const key = `${Math.min(srcInt, tgtInt)}:${Math.max(srcInt, tgtInt)}:${edge.type}`
    const arr = oldEdgesByKey.get(key)
    if (arr) arr.push(edgeId)
    else oldEdgesByKey.set(key, [edgeId])
  }

  const survivingEdges = new Map<string, Edge>()
  const addedEdges = new Map<string, Edge>()
  const matchedOldEdgeIds = new Set<string>()

  for (const [src, tgt, edgeType] of json.edges) {
    const sourceNanoid = newIntToNanoid.get(src)!
    const targetNanoid = newIntToNanoid.get(tgt)!
    const eType = (edgeType ?? EdgeType.Simple) as EdgeType

    // Try to match to an old edge
    const key = `${Math.min(src, tgt)}:${Math.max(src, tgt)}:${eType}`
    const candidates = oldEdgesByKey.get(key)
    let matched = false

    if (candidates) {
      // Find first unmatched candidate
      for (let i = 0; i < candidates.length; i++) {
        if (!matchedOldEdgeIds.has(candidates[i])) {
          const oldEdgeId = candidates[i]
          matchedOldEdgeIds.add(oldEdgeId)
          const edge: Edge = {
            id: oldEdgeId,
            source: sourceNanoid,
            target: targetNanoid,
            type: eType,
          }
          survivingEdges.set(oldEdgeId, edge)
          matched = true
          break
        }
      }
    }

    if (!matched) {
      const id = nanoid()
      const edge: Edge = { id, source: sourceNanoid, target: targetNanoid, type: eType }
      addedEdges.set(id, edge)
    }
  }

  // Removed edges: old edges not matched
  const removedEdgeIds = new Set<string>()
  for (const edgeId of oldGraph.edges.keys()) {
    if (!matchedOldEdgeIds.has(edgeId)) {
      removedEdgeIds.add(edgeId)
    }
  }

  // 6. Build new GraphData
  const nodes = new Map<string, Node>()
  const incidentEdges = new Map<string, Set<string>>()

  // Add all nodes (surviving + added)
  for (const [id, node] of survivingNodes) {
    nodes.set(id, node)
    incidentEdges.set(id, new Set())
  }
  for (const [id, node] of addedNodes) {
    nodes.set(id, node)
    incidentEdges.set(id, new Set())
  }

  // Add all edges (surviving + added) and build incidence
  const edges = new Map<string, Edge>()
  function addEdgeToGraph(edge: Edge) {
    edges.set(edge.id, edge)
    incidentEdges.get(edge.source)!.add(edge.id)
    if (edge.source !== edge.target) {
      incidentEdges.get(edge.target)!.add(edge.id)
    }
  }

  for (const edge of survivingEdges.values()) addEdgeToGraph(edge)
  for (const edge of addedEdges.values()) addEdgeToGraph(edge)

  // Inputs/outputs — map through int→nanoid
  const inputs = (json.inputs ?? []).map(n => newIntToNanoid.get(n)!).filter(Boolean)
  const outputs = (json.outputs ?? []).map(n => newIntToNanoid.get(n)!).filter(Boolean)

  const newGraph: GraphData = {
    nodes,
    edges,
    incidentEdges,
    inputs,
    outputs,
    scalar: json.scalar ? { ...json.scalar } : undefined,
  }

  const diff: GraphDiff = {
    survivingNodes,
    removedNodeIds,
    addedNodes,
    survivingEdges,
    removedEdgeIds,
    addedEdges,
  }

  return { newGraph, diff }
}
