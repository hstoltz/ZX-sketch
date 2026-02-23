import { nanoid } from 'nanoid'
import { NodeType, EdgeType } from './types.ts'
import type { GraphData } from './types.ts'
import { phaseToJsonString, phaseFromJsonString, ZERO } from './Phase.ts'

// --- PyZX v2 JSON Format ---
// This is the format used by PyZX 0.9.0+ (the version on pip).
// Vertices are an array of objects, edges are an array of tuples.

interface PyZXV2Vertex {
  id: number
  t: number           // VertexType: 0=boundary, 1=Z, 2=X
  pos: [number, number] // [row, qubit] — we use [x, y]
  phase?: string       // fraction of pi, e.g. "1/4"
  ground?: boolean
}

interface PyZXV2Json {
  version: 2
  backend: string
  auto_simplify?: boolean
  variable_types: Record<string, never>
  scalar?: { power2: number; phase: string }
  inputs: number[]
  outputs: number[]
  vertices: PyZXV2Vertex[]
  edges: [number, number, number][]  // [src, tgt, edgeType]
}

/** Result of exporting a graph with ID mapping preserved. */
export interface SerializeResult {
  json: string
  nanoidToInt: Map<string, number>
}

/**
 * Export a graph to PyZX v2 JSON string, also returning the nanoid→int mapping.
 * The mapping is needed for reconciliation after PyZX rewrites.
 *
 * @param circuitSpace  If true, divide pos by GRID_SCALE so PyZX gets clean
 *                      circuit-space row/qubit values (needed for good layout
 *                      of newly created vertices during simplification).
 */
export function toJSONWithMap(g: GraphData, circuitSpace = false): SerializeResult {
  const posDivisor = circuitSpace ? GRID_SCALE : 1

  // Build a mapping from internal IDs to sequential integers
  const idToInt = new Map<string, number>()
  let nextId = 0
  for (const id of g.nodes.keys()) {
    idToInt.set(id, nextId++)
  }

  // Vertices — array of {id, t, pos, phase?}
  const vertices: PyZXV2Vertex[] = []
  for (const [id, node] of g.nodes) {
    const intId = idToInt.get(id)!
    const v: PyZXV2Vertex = {
      id: intId,
      t: node.type as number,
      pos: [node.x / posDivisor, node.y / posDivisor],
    }
    const phaseStr = phaseToJsonString(node.phase)
    if (phaseStr !== '0') {
      v.phase = phaseStr
    }
    if (node.ground) {
      v.ground = true
    }
    vertices.push(v)
  }

  // Edges — array of [src, tgt, type]
  const edges: [number, number, number][] = []
  for (const edge of g.edges.values()) {
    const src = idToInt.get(edge.source)
    const tgt = idToInt.get(edge.target)
    if (src === undefined || tgt === undefined) continue
    edges.push([src, tgt, edge.type as number])
  }

  // Inputs / outputs (integer arrays)
  const inputs = g.inputs.map(id => idToInt.get(id)).filter((n): n is number => n !== undefined)
  const outputs = g.outputs.map(id => idToInt.get(id)).filter((n): n is number => n !== undefined)

  const result: PyZXV2Json = {
    version: 2,
    backend: 'multigraph',
    auto_simplify: false,
    variable_types: {} as Record<string, never>,
    inputs,
    outputs,
    vertices,
    edges,
  }

  if (g.scalar) {
    result.scalar = { ...g.scalar }
  }

  return { json: JSON.stringify(result), nanoidToInt: idToInt }
}

/**
 * Export a graph to PyZX v2 JSON string.
 * Uses sequential integer IDs matching array indices.
 */
export function toJSON(g: GraphData, circuitSpace = false): string {
  return toJSONWithMap(g, circuitSpace).json
}

/** Scale factor for converting PyZX grid coordinates to canvas world coordinates. */
const GRID_SCALE = 80

/**
 * Import a graph from PyZX v2 JSON string.
 * Also handles ZXLive .zxp format (unwraps "initial_graph" wrapper).
 *
 * @param scalePositions  If true, multiply positions by GRID_SCALE (for graphs
 *                        stored in circuit-space coordinates, e.g. ZXLive files).
 */
export function fromJSON(jsonStr: string, scalePositions = false): GraphData {
  let json: PyZXV2Json = JSON.parse(jsonStr)

  // Unwrap ZXLive .zxp format: { initial_graph: {...}, proof_steps: [] }
  let needsScale = scalePositions
  if ('initial_graph' in (json as unknown as Record<string, unknown>)) {
    json = (json as unknown as Record<string, unknown>).initial_graph as PyZXV2Json
    needsScale = true
  }

  // Scale circuit-space coordinates to canvas world coordinates if needed.
  if (needsScale && json.vertices.length > 0) {
    const maxPos = json.vertices.reduce(
      (m, v) => Math.max(m, Math.abs(v.pos[0]), Math.abs(v.pos[1])), 0,
    )
    if (maxPos < GRID_SCALE) {
      json = {
        ...json,
        vertices: json.vertices.map(v => ({
          ...v,
          pos: [v.pos[0] * GRID_SCALE, v.pos[1] * GRID_SCALE] as [number, number],
        })),
      }
    }
  }
  const intToId = new Map<number, string>()
  const nodes = new Map<string, import('./types.ts').Node>()
  const incidentEdges = new Map<string, Set<string>>()

  for (const v of json.vertices) {
    const id = nanoid()
    intToId.set(v.id, id)

    const nodeType = v.t as NodeType
    const p = v.phase ? phaseFromJsonString(v.phase) : ZERO

    nodes.set(id, {
      id,
      type: nodeType,
      x: v.pos[0],
      y: v.pos[1],
      phase: p,
      ground: v.ground || undefined,
    })
    incidentEdges.set(id, new Set())
  }

  const edges = new Map<string, import('./types.ts').Edge>()

  for (const e of json.edges) {
    const [src, tgt, edgeType] = e
    const sourceId = intToId.get(src)
    const targetId = intToId.get(tgt)
    if (!sourceId || !targetId) {
      throw new Error(`Edge references nonexistent vertex: src=${src}, tgt=${tgt}`)
    }

    const id = nanoid()
    edges.set(id, {
      id,
      source: sourceId,
      target: targetId,
      type: (edgeType ?? EdgeType.Simple) as EdgeType,
    })

    incidentEdges.get(sourceId)!.add(id)
    if (sourceId !== targetId) {
      incidentEdges.get(targetId)!.add(id)
    }
  }

  const inputs = (json.inputs ?? []).map(n => intToId.get(n)!).filter(Boolean)
  const outputs = (json.outputs ?? []).map(n => intToId.get(n)!).filter(Boolean)

  return {
    nodes,
    edges,
    incidentEdges,
    inputs,
    outputs,
    scalar: json.scalar ? { ...json.scalar } : undefined,
  }
}


/**
 * Check structural equality between two graphs (ignoring IDs).
 * Useful for round-trip testing.
 */
export function graphsStructurallyEqual(a: GraphData, b: GraphData): boolean {
  if (a.nodes.size !== b.nodes.size) return false
  if (a.edges.size !== b.edges.size) return false
  if (a.inputs.length !== b.inputs.length) return false
  if (a.outputs.length !== b.outputs.length) return false

  // Compare by re-serializing: toJSON produces a canonical form (sequential IDs)
  // so two structurally equal graphs should produce the same JSON.
  const jsonA = toJSON(a)
  const jsonB = toJSON(b)
  return jsonA === jsonB
}
