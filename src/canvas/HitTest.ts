import RBush from 'rbush'
import { NodeType } from '../model/types.ts'
import type { Node, GraphData } from '../model/types.ts'
import { SPIDER_RADIUS } from './elements.ts'

const BOUNDARY_RADIUS = 5
const EDGE_HIT_THRESHOLD = 8  // px in world space

export type DragZone = 'move' | 'wire'

export interface NodeHit {
  type: 'node'
  nodeId: string
  zone: DragZone
}

export interface EdgeHit {
  type: 'edge'
  edgeId: string
}

export type HitResult = NodeHit | EdgeHit | null

interface RBushItem {
  minX: number
  minY: number
  maxX: number
  maxY: number
  nodeId: string
}

const tree = new RBush<RBushItem>()

/** Rebuild the spatial index from the current graph. Call after any graph mutation. */
export function rebuildSpatialIndex(graph: GraphData): void {
  tree.clear()
  const items: RBushItem[] = []
  for (const node of graph.nodes.values()) {
    const r = nodeRadius(node)
    items.push({
      minX: node.x - r,
      minY: node.y - r,
      maxX: node.x + r,
      maxY: node.y + r,
      nodeId: node.id,
    })
  }
  tree.load(items)
}

function nodeRadius(node: Node): number {
  return node.type === NodeType.Boundary ? BOUNDARY_RADIUS : SPIDER_RADIUS
}

/** Hit-test the forgiving radius (slightly larger than visual). */
function hitRadius(node: Node): number {
  return nodeRadius(node) + 4
}

/**
 * Hit test at a world-space point. Returns the topmost hit (nodes before edges).
 * For spiders, also determines the drag zone (inner 60% = move, outer 40% = wire).
 * @param touchPadding Extra hit radius in world-space pixels for touch input (0 for mouse/pen).
 */
export function hitTest(graph: GraphData, wx: number, wy: number, zoom: number, touchPadding = 0): HitResult {
  // Query R-tree for candidate nodes near the point
  const queryR = (SPIDER_RADIUS + 4 + touchPadding)
  const candidates = tree.search({
    minX: wx - queryR,
    minY: wy - queryR,
    maxX: wx + queryR,
    maxY: wy + queryR,
  })

  // Test nodes (on top of edges visually)
  let closestNode: NodeHit | null = null
  let closestDist = Infinity

  for (const item of candidates) {
    const node = graph.nodes.get(item.nodeId)
    if (!node) continue

    const dx = wx - node.x
    const dy = wy - node.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist <= hitRadius(node) + touchPadding && dist < closestDist) {
      closestDist = dist
      const r = nodeRadius(node)

      // Drag zone: inner 60% = move, outer 40% = wire
      let zone: DragZone = 'move'
      if (node.type !== NodeType.Boundary && dist > r * 0.6) {
        zone = 'wire'
      }

      closestNode = { type: 'node', nodeId: node.id, zone }
    }
  }

  if (closestNode) return closestNode

  // Test edges (below nodes)
  const threshold = (EDGE_HIT_THRESHOLD + touchPadding) / zoom
  for (const edge of graph.edges.values()) {
    const source = graph.nodes.get(edge.source)
    const target = graph.nodes.get(edge.target)
    if (!source || !target) continue

    // Self-loops: use a simple distance check to the loop apex
    if (edge.source === edge.target) {
      const apex_y = source.y - 48  // approximate loop apex (matches SELF_LOOP_SIZE in elements.ts)
      const dx = wx - source.x
      const dy = wy - apex_y
      if (Math.sqrt(dx * dx + dy * dy) < threshold + 10) {
        return { type: 'edge', edgeId: edge.id }
      }
      continue
    }

    // Point-to-line-segment distance
    const dist = pointToSegmentDist(wx, wy, source.x, source.y, target.x, target.y)
    if (dist < threshold) {
      return { type: 'edge', edgeId: edge.id }
    }
  }

  return null
}

/** Point-to-line-segment distance. */
function pointToSegmentDist(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy

  if (lenSq === 0) {
    // Degenerate: source === target
    const ex = px - ax
    const ey = py - ay
    return Math.sqrt(ex * ex + ey * ey)
  }

  // Project point onto line, clamped to [0, 1]
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))

  const projX = ax + t * dx
  const projY = ay + t * dy
  const ex = px - projX
  const ey = py - projY
  return Math.sqrt(ex * ex + ey * ey)
}

/**
 * Get all node IDs within a world-space rectangle (for box selection).
 */
export function nodesInRect(
  graph: GraphData,
  x1: number, y1: number, x2: number, y2: number,
): string[] {
  const minX = Math.min(x1, x2)
  const minY = Math.min(y1, y2)
  const maxX = Math.max(x1, x2)
  const maxY = Math.max(y1, y2)

  const candidates = tree.search({ minX, minY, maxX, maxY })
  const result: string[] = []

  for (const item of candidates) {
    const node = graph.nodes.get(item.nodeId)
    if (node && node.x >= minX && node.x <= maxX && node.y >= minY && node.y <= maxY) {
      result.push(node.id)
    }
  }

  return result
}
