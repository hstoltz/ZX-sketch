import { NodeType, EdgeType } from '../model/types.ts'
import type { Node, Edge, GraphData } from '../model/types.ts'
import { phaseToString } from '../model/Phase.ts'
import type { AnimationManager, GhostNode, GhostEdge } from './Animations.ts'
import type { UnfusePartition } from '../AppState.ts'
import { getCanvasTheme } from '../theme/ThemeManager.ts'

// --- Visual constants ---

export const SPIDER_RADIUS = 16
const BOUNDARY_RADIUS = 5
const HADAMARD_BOX_SIZE = 10
const EDGE_WIDTH = 2.2
const SELF_LOOP_SIZE = 48
const MULTI_EDGE_SPACING = 14

// --- Edge rendering ---

interface EdgeGroup {
  edges: Edge[]
  sourceId: string
  targetId: string
}

/** Group edges by their (unordered) endpoint pair for multi-edge rendering. */
function groupEdges(graph: GraphData): EdgeGroup[] {
  const map = new Map<string, EdgeGroup>()
  for (const edge of graph.edges.values()) {
    // Canonical key: smaller ID first
    const a = edge.source < edge.target ? edge.source : edge.target
    const b = edge.source < edge.target ? edge.target : edge.source
    const isSelfLoop = edge.source === edge.target
    const key = isSelfLoop ? `self:${edge.source}` : `${a}:${b}`
    let group = map.get(key)
    if (!group) {
      group = { edges: [], sourceId: edge.source, targetId: edge.target }
      map.set(key, group)
    }
    group.edges.push(edge)
  }
  return [...map.values()]
}

/** Half-length of the Hopf cut line (perpendicular to edge). */
export const HOPF_CUT_HALF = 20

/** Compute the visual midpoint of an edge, accounting for multi-edge curvature. */
export function edgeMidpoint(graph: GraphData, edgeId: string): { x: number; y: number } | null {
  const edge = graph.edges.get(edgeId)
  if (!edge) return null
  const s = graph.nodes.get(edge.source)
  const t = graph.nodes.get(edge.target)
  if (!s || !t) return null
  if (edge.source === edge.target) return null // self-loop

  // Count sibling edges between same endpoints
  const a = edge.source < edge.target ? edge.source : edge.target
  const b = edge.source < edge.target ? edge.target : edge.source
  let total = 0
  let index = 0
  for (const e of graph.edges.values()) {
    const ea = e.source < e.target ? e.source : e.target
    const eb = e.source < e.target ? e.target : e.source
    if (ea === a && eb === b) {
      if (e.id === edgeId) index = total
      total++
    }
  }

  if (total === 1) {
    return { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 }
  }

  const dx = t.x - s.x
  const dy = t.y - s.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const px = -dy / len
  const py = dx / len
  const offset = (index - (total - 1) / 2) * MULTI_EDGE_SPACING
  const cpx = (s.x + t.x) / 2 + px * offset * 2
  const cpy = (s.y + t.y) / 2 + py * offset * 2
  return { x: s.x * 0.25 + cpx * 0.5 + t.x * 0.25, y: s.y * 0.25 + cpy * 0.5 + t.y * 0.25 }
}

export function drawEdges(
  ctx: CanvasRenderingContext2D,
  graph: GraphData,
  selectedEdges: Set<string>,
  hoveredEdge: string | null,
  animations: AnimationManager | null = null,
  hoverWorld: { x: number; y: number } | null = null,
  hopfCutEdges: Map<string, [string, string]> | null = null,
  unfusePartition: UnfusePartition | null = null,
): void {
  const groups = groupEdges(graph)
  // Collect one cut line per Hopf vertex pair (not per edge) — draw at center between wires
  const cutLineMap = new Map<string, { mx: number; my: number; px: number; py: number }>()

  // Pre-compute which edges should glow because cursor is near their Hopf cut line
  const hopfGlowEdges = new Set<string>()
  if (hopfCutEdges && hopfCutEdges.size > 0 && hoverWorld) {
    // Group edges by vertex pair and compute midpoints
    const pairEdges = new Map<string, string[]>()
    for (const [edgeId, match] of hopfCutEdges) {
      const key = match[0] < match[1] ? `${match[0]}:${match[1]}` : `${match[1]}:${match[0]}`
      if (!pairEdges.has(key)) pairEdges.set(key, [])
      pairEdges.get(key)!.push(edgeId)
    }
    for (const [key, edgeIds] of pairEdges) {
      const [id0, id1] = key.split(':')
      const s = graph.nodes.get(id0)
      const t = graph.nodes.get(id1)
      if (s && t) {
        const mx = (s.x + t.x) / 2
        const my = (s.y + t.y) / 2
        const edx = t.x - s.x
        const edy = t.y - s.y
        const elen = Math.sqrt(edx * edx + edy * edy) || 1
        const px = -edy / elen
        const py = edx / elen
        const offx = hoverWorld.x - mx
        const offy = hoverWorld.y - my
        const projCut = Math.abs(offx * px + offy * py)
        const projEdge = Math.abs(offx * py - offy * px)
        if (projCut <= HOPF_CUT_HALF + 6 && projEdge <= 10) {
          for (const eid of edgeIds) hopfGlowEdges.add(eid)
        }
      }
    }
  }

  for (const group of groups) {
    const sourceNode = graph.nodes.get(group.sourceId)
    const targetNode = graph.nodes.get(group.targetId)
    if (!sourceNode || !targetNode) continue

    const isSelfLoop = group.sourceId === group.targetId
    const count = group.edges.length

    for (let i = 0; i < count; i++) {
      const edge = group.edges[i]
      const isSelected = selectedEdges.has(edge.id)
      const isHovered = hoveredEdge === edge.id || hopfGlowEdges.has(edge.id)
      const edgeOpacity = animations?.getEdgeOpacity(edge.id) ?? 1

      // Apply node move offsets to edge endpoints
      const srcOffset = animations?.getNodeOffset(group.sourceId) ?? { dx: 0, dy: 0 }
      const tgtOffset = animations?.getNodeOffset(group.targetId) ?? { dx: 0, dy: 0 }
      const srcWithOffset = { ...sourceNode, x: sourceNode.x + srcOffset.dx, y: sourceNode.y + srcOffset.dy }
      const tgtWithOffset = { ...targetNode, x: targetNode.x + tgtOffset.dx, y: targetNode.y + tgtOffset.dy }

      // Unfuse partition mode: determine if edge is incident and which side
      let partitionDim = false
      let partitionColor: string | null = null
      if (unfusePartition) {
        const isIncident = unfusePartition.allEdges.includes(edge.id)
        if (isIncident) {
          const isNewSide = unfusePartition.newSideEdges.has(edge.id)
          partitionColor = isNewSide ? 'rgba(46, 168, 168, 0.55)' : 'rgba(232, 168, 50, 0.55)'
        } else {
          partitionDim = true
        }
      }

      if (edgeOpacity < 1 || partitionDim) {
        ctx.save()
        ctx.globalAlpha = Math.max(0, partitionDim ? 0.25 : edgeOpacity)
      }

      if (isSelfLoop) {
        drawSelfLoop(ctx, srcWithOffset, i, count, edge, isSelected, isHovered)
      } else if (count === 1) {
        drawStraightEdge(ctx, srcWithOffset, tgtWithOffset, edge, isSelected, isHovered, isHovered ? hoverWorld : null)
      } else {
        drawCurvedEdge(ctx, srcWithOffset, tgtWithOffset, i, count, edge, isSelected, isHovered, isHovered ? hoverWorld : null)
      }

      if (edgeOpacity < 1 || partitionDim) {
        ctx.restore()
      }

      // Partition color overlay on incident edges
      if (partitionColor && !isSelfLoop) {
        ctx.save()
        ctx.globalAlpha = 1
        if (count === 1) {
          ctx.beginPath()
          ctx.moveTo(srcWithOffset.x, srcWithOffset.y)
          ctx.lineTo(tgtWithOffset.x, tgtWithOffset.y)
        } else {
          const dx = tgtWithOffset.x - srcWithOffset.x
          const dy = tgtWithOffset.y - srcWithOffset.y
          const len = Math.sqrt(dx * dx + dy * dy) || 1
          const px = -dy / len
          const py = dx / len
          const offset = (i - (count - 1) / 2) * MULTI_EDGE_SPACING
          const mx = (srcWithOffset.x + tgtWithOffset.x) / 2 + px * offset * 2
          const my = (srcWithOffset.y + tgtWithOffset.y) / 2 + py * offset * 2
          ctx.beginPath()
          ctx.moveTo(srcWithOffset.x, srcWithOffset.y)
          ctx.quadraticCurveTo(mx, my, tgtWithOffset.x, tgtWithOffset.y)
        }
        ctx.strokeStyle = partitionColor
        ctx.lineWidth = EDGE_WIDTH + 4
        ctx.stroke()
        ctx.restore()
      }

      // Collect one Hopf cut line per vertex pair (at straight-line midpoint between nodes)
      if (hopfCutEdges?.has(edge.id) && !isSelfLoop) {
        const match = hopfCutEdges.get(edge.id)!
        const pairKey = match[0] < match[1] ? `${match[0]}:${match[1]}` : `${match[1]}:${match[0]}`
        if (!cutLineMap.has(pairKey)) {
          const s = srcWithOffset
          const t = tgtWithOffset
          const edx = t.x - s.x
          const edy = t.y - s.y
          const elen = Math.sqrt(edx * edx + edy * edy) || 1
          cutLineMap.set(pairKey, {
            mx: (s.x + t.x) / 2,
            my: (s.y + t.y) / 2,
            px: -edy / elen,
            py: edx / elen,
          })
        }
      }
    }
  }

  // Draw all Hopf cut lines on top
  if (cutLineMap.size > 0) {
    drawHopfCutLines(ctx, [...cutLineMap.values()], hoverWorld)
  }
}

function drawHopfCutLines(
  ctx: CanvasRenderingContext2D,
  cutLines: { mx: number; my: number; px: number; py: number }[],
  hoverWorld: { x: number; y: number } | null,
): void {
  ctx.save()
  ctx.lineCap = 'butt'

  for (const cl of cutLines) {
    // Check if cursor is near this cut line (rectangular zone)
    let isNearCursor = false
    if (hoverWorld) {
      const offx = hoverWorld.x - cl.mx
      const offy = hoverWorld.y - cl.my
      const projCut = Math.abs(offx * cl.px + offy * cl.py)
      const projEdge = Math.abs(offx * cl.py - offy * cl.px)
      isNearCursor = projCut <= HOPF_CUT_HALF + 6 && projEdge <= 10
    }

    const x1 = cl.mx - cl.px * HOPF_CUT_HALF
    const y1 = cl.my - cl.py * HOPF_CUT_HALF
    const x2 = cl.mx + cl.px * HOPF_CUT_HALF
    const y2 = cl.my + cl.py * HOPF_CUT_HALF

    // Draw dashed perpendicular line
    ctx.setLineDash(isNearCursor ? [] : [5, 4])
    ctx.strokeStyle = isNearCursor ? 'rgba(196, 43, 43, 0.9)' : 'rgba(196, 43, 43, 0.45)'
    ctx.lineWidth = isNearCursor ? 3.5 : 2.5
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  ctx.setLineDash([])
  ctx.restore()
}

function drawStraightEdge(
  ctx: CanvasRenderingContext2D,
  source: Node,
  target: Node,
  edge: Edge,
  isSelected: boolean,
  isHovered: boolean,
  hoverWorld: { x: number; y: number } | null = null,
): void {
  const theme = getCanvasTheme()
  const isHadamard = edge.type === EdgeType.Hadamard
  const mx = (source.x + target.x) / 2
  const my = (source.y + target.y) / 2

  if (isHadamard && isHovered && !isSelected) {
    // Partial half-glow for hover only (not selection)
    const dSrc = hoverWorld ? (hoverWorld.x - source.x) ** 2 + (hoverWorld.y - source.y) ** 2 : 0
    const dTgt = hoverWorld ? (hoverWorld.x - target.x) ** 2 + (hoverWorld.y - target.y) ** 2 : 0
    const nearSource = !hoverWorld || dSrc <= dTgt

    ctx.beginPath()
    if (nearSource) {
      ctx.moveTo(source.x, source.y)
      ctx.lineTo(mx, my)
    } else {
      ctx.moveTo(mx, my)
      ctx.lineTo(target.x, target.y)
    }
    ctx.strokeStyle = theme.hoverGlow
    ctx.lineWidth = EDGE_WIDTH + 3
    ctx.stroke()

    // Draw the full edge line
    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    ctx.lineTo(target.x, target.y)
    ctx.strokeStyle = theme.edgeColor
    ctx.lineWidth = EDGE_WIDTH
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    ctx.lineTo(target.x, target.y)

    if (isSelected) {
      ctx.strokeStyle = theme.selectionGlow
      ctx.lineWidth = EDGE_WIDTH + 4
      ctx.stroke()
    } else if (isHovered) {
      ctx.strokeStyle = theme.hoverGlow
      ctx.lineWidth = EDGE_WIDTH + 3
      ctx.stroke()
    }

    ctx.strokeStyle = theme.edgeColor
    ctx.lineWidth = EDGE_WIDTH
    ctx.stroke()
  }

  if (isHadamard) {
    drawHadamardBox(ctx, mx, my)
  }
}

function drawCurvedEdge(
  ctx: CanvasRenderingContext2D,
  source: Node,
  target: Node,
  index: number,
  total: number,
  edge: Edge,
  isSelected: boolean,
  isHovered: boolean,
  hoverWorld: { x: number; y: number } | null = null,
): void {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1

  // Perpendicular unit vector
  const px = -dy / len
  const py = dx / len

  // Spread edges symmetrically around the center line
  const offset = (index - (total - 1) / 2) * MULTI_EDGE_SPACING

  // Control point at midpoint, offset perpendicular
  const mx = (source.x + target.x) / 2 + px * offset * 2
  const my = (source.y + target.y) / 2 + py * offset * 2

  const theme = getCanvasTheme()
  const isHadamard = edge.type === EdgeType.Hadamard

  if (isHadamard && isHovered && !isSelected) {
    // Partial half-glow for hover only (not selection)
    const hmx = source.x * 0.25 + mx * 0.5 + target.x * 0.25
    const hmy = source.y * 0.25 + my * 0.5 + target.y * 0.25

    const dSrc = hoverWorld ? (hoverWorld.x - source.x) ** 2 + (hoverWorld.y - source.y) ** 2 : 0
    const dTgt = hoverWorld ? (hoverWorld.x - target.x) ** 2 + (hoverWorld.y - target.y) ** 2 : 0
    const nearSource = !hoverWorld || dSrc <= dTgt

    // Draw glow on the hovered half only (split at t=0.5)
    ctx.beginPath()
    if (nearSource) {
      const cp1x = (source.x + mx) / 2
      const cp1y = (source.y + my) / 2
      ctx.moveTo(source.x, source.y)
      ctx.quadraticCurveTo(cp1x, cp1y, hmx, hmy)
    } else {
      const cp2x = (mx + target.x) / 2
      const cp2y = (my + target.y) / 2
      ctx.moveTo(hmx, hmy)
      ctx.quadraticCurveTo(cp2x, cp2y, target.x, target.y)
    }
    ctx.strokeStyle = theme.hoverGlow
    ctx.lineWidth = EDGE_WIDTH + 3
    ctx.stroke()

    // Draw the full edge line
    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    ctx.quadraticCurveTo(mx, my, target.x, target.y)
    ctx.strokeStyle = theme.edgeColor
    ctx.lineWidth = EDGE_WIDTH
    ctx.stroke()

    drawHadamardBox(ctx, hmx, hmy)
  } else {
    ctx.beginPath()
    ctx.moveTo(source.x, source.y)
    ctx.quadraticCurveTo(mx, my, target.x, target.y)

    if (isSelected) {
      ctx.strokeStyle = theme.selectionGlow
      ctx.lineWidth = EDGE_WIDTH + 4
      ctx.stroke()
    } else if (isHovered) {
      ctx.strokeStyle = theme.hoverGlow
      ctx.lineWidth = EDGE_WIDTH + 3
      ctx.stroke()
    }

    ctx.strokeStyle = theme.edgeColor
    ctx.lineWidth = EDGE_WIDTH
    ctx.stroke()

    if (isHadamard) {
      const hmx = source.x * 0.25 + mx * 0.5 + target.x * 0.25
      const hmy = source.y * 0.25 + my * 0.5 + target.y * 0.25
      drawHadamardBox(ctx, hmx, hmy)
    }
  }
}

function drawSelfLoop(
  ctx: CanvasRenderingContext2D,
  node: Node,
  index: number,
  total: number,
  edge: Edge,
  isSelected: boolean,
  isHovered: boolean,
): void {
  // Spread self-loops at different angles around the node
  const baseAngle = -Math.PI / 2 // start at top
  const angleSpread = total > 1 ? Math.PI / 3 : 0
  const angle = baseAngle + (index - (total - 1) / 2) * angleSpread

  const loopDist = SELF_LOOP_SIZE
  const spread = 0.65

  // Two control points flanking the exit angle
  const cp1x = node.x + Math.cos(angle - spread) * loopDist
  const cp1y = node.y + Math.sin(angle - spread) * loopDist
  const cp2x = node.x + Math.cos(angle + spread) * loopDist
  const cp2y = node.y + Math.sin(angle + spread) * loopDist

  const theme = getCanvasTheme()
  ctx.beginPath()
  ctx.moveTo(node.x, node.y)
  ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, node.x, node.y)

  if (isSelected) {
    ctx.strokeStyle = theme.selectionGlow
    ctx.lineWidth = EDGE_WIDTH + 4
    ctx.stroke()
  } else if (isHovered) {
    ctx.strokeStyle = theme.hoverGlow
    ctx.lineWidth = EDGE_WIDTH + 3
    ctx.stroke()
  }

  ctx.strokeStyle = theme.edgeColor
  ctx.lineWidth = EDGE_WIDTH
  ctx.stroke()

  if (edge.type === EdgeType.Hadamard) {
    // Midpoint of the cubic bezier at t=0.5
    const hmx = node.x * 0.125 + cp1x * 0.375 + cp2x * 0.375 + node.x * 0.125
    const hmy = node.y * 0.125 + cp1y * 0.375 + cp2y * 0.375 + node.y * 0.125
    drawHadamardBox(ctx, hmx, hmy)
  }
}

function drawHadamardBox(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const theme = getCanvasTheme()
  const s = HADAMARD_BOX_SIZE
  ctx.fillStyle = theme.hadamardFill
  ctx.fillRect(x - s / 2, y - s / 2, s, s)
  ctx.strokeStyle = theme.hadamardStroke
  ctx.lineWidth = 1.2
  ctx.strokeRect(x - s / 2, y - s / 2, s, s)
}

// --- Node rendering ---

export function drawNodes(
  ctx: CanvasRenderingContext2D,
  graph: GraphData,
  selectedNodes: Set<string>,
  hoveredNode: string | null,
  selectionPulse: number,
  wireTargetNode: string | null = null,
  fusionTargetNode: string | null = null,
  animations: AnimationManager | null = null,
  rewriteHighlightNodes: Set<string> | null = null,
  idRemovalNodes: Set<string> | null = null,
  hoverWorld: { x: number; y: number } | null = null,
): void {
  for (const node of graph.nodes.values()) {
    const isSelected = selectedNodes.has(node.id)
    const isHovered = hoveredNode === node.id
    const isWireTarget = wireTargetNode === node.id
    const isFusionTarget = fusionTargetNode === node.id
    const isRewriteHighlighted = rewriteHighlightNodes?.has(node.id) ?? false
    const isIdRemoval = idRemovalNodes?.has(node.id) ?? false

    const scale = animations?.getNodeScale(node.id) ?? 1
    const opacity = animations?.getNodeOpacity(node.id) ?? 1
    const offset = animations?.getNodeOffset(node.id) ?? { dx: 0, dy: 0 }

    if (scale <= 0.01) continue // skip invisible nodes

    ctx.save()
    if (offset.dx !== 0 || offset.dy !== 0) {
      ctx.translate(offset.dx, offset.dy)
    }
    if (scale !== 1 || opacity !== 1) {
      ctx.globalAlpha = Math.max(0, Math.min(1, opacity))
      ctx.translate(node.x, node.y)
      ctx.scale(scale, scale)
      ctx.translate(-node.x, -node.y)
    }

    // Check if cursor is over the tiny X hitbox at spider center
    let isOverXHitbox = false
    if (isIdRemoval && isHovered && hoverWorld) {
      const hdx = hoverWorld.x - node.x
      const hdy = hoverWorld.y - node.y
      isOverXHitbox = Math.sqrt(hdx * hdx + hdy * hdy) <= SPIDER_RADIUS * 0.35
    }

    if (node.type === NodeType.Boundary) {
      drawBoundaryNode(ctx, node, isSelected, isHovered, selectionPulse, isWireTarget, isRewriteHighlighted)
    } else {
      drawSpider(ctx, node, isSelected, isHovered, selectionPulse, isWireTarget, isFusionTarget, isRewriteHighlighted, isIdRemoval, isOverXHitbox)
    }

    ctx.restore()
  }
}

/** Draw ghost nodes (deleted nodes still animating out). */
export function drawGhostNodes(
  ctx: CanvasRenderingContext2D,
  ghosts: GhostNode[],
): void {
  for (const ghost of ghosts) {
    const scale = ghost.anim.scale.value
    const opacity = ghost.anim.opacity.value

    if (scale <= 0.01 || opacity <= 0.01) continue

    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity))
    ctx.translate(ghost.x, ghost.y)
    ctx.scale(scale, scale)
    ctx.translate(-ghost.x, -ghost.y)

    const node: Node = {
      id: ghost.id,
      type: ghost.type as NodeType,
      x: ghost.x,
      y: ghost.y,
      phase: { n: 0, d: 1 },
    }

    if (node.type === NodeType.Boundary) {
      drawBoundaryNode(ctx, node, false, false, 0, false)
    } else {
      drawSpider(ctx, node, false, false, 0, false, false)
    }

    ctx.restore()
  }
}

function drawSpider(
  ctx: CanvasRenderingContext2D,
  node: Node,
  isSelected: boolean,
  isHovered: boolean,
  selectionPulse: number,
  isWireTarget: boolean = false,
  isFusionTarget: boolean = false,
  isRewriteHighlighted: boolean = false,
  isIdRemoval: boolean = false,
  isOverXHitbox: boolean = false,
): void {
  const theme = getCanvasTheme()
  const r = SPIDER_RADIUS
  const isZ = node.type === NodeType.Z
  const outerColor = isZ ? theme.zOuter : theme.xOuter
  const innerColor = isZ ? theme.zInner : theme.xInner

  // Fusion target glow (magnetic pull indicator — bright, pulsing)
  if (isFusionTarget) {
    const fusionColor = isZ ? theme.fusionGlowZ : theme.fusionGlowX
    ctx.beginPath()
    ctx.arc(node.x, node.y, r + 10, 0, Math.PI * 2)
    ctx.fillStyle = fusionColor
    ctx.fill()
  }

  // Wire target glow (connection candidate)
  if (isWireTarget) {
    ctx.beginPath()
    ctx.arc(node.x, node.y, r + 8, 0, Math.PI * 2)
    ctx.fillStyle = theme.wireTargetGlow
    ctx.fill()
  }

  // Rewrite match glow (amber)
  if (isRewriteHighlighted && !isFusionTarget && !isWireTarget) {
    ctx.beginPath()
    ctx.arc(node.x, node.y, r + 8, 0, Math.PI * 2)
    ctx.fillStyle = theme.rewriteMatchGlow
    ctx.fill()
  }

  // Selection glow (pulsing)
  if (isSelected && !isFusionTarget) {
    const glowAlpha = 0.35 + 0.2 * selectionPulse
    ctx.beginPath()
    ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(80, 140, 255, ${glowAlpha})`
    ctx.fill()
  } else if (isHovered && !isWireTarget && !isFusionTarget) {
    ctx.beginPath()
    ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2)
    ctx.fillStyle = theme.hoverGlow
    ctx.fill()
  }

  ctx.beginPath()
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2)

  if (theme.useGradient) {
    // Radial gradient: lighter center, darker edge — gives dimensionality
    const grad = ctx.createRadialGradient(
      node.x - r * 0.3, node.y - r * 0.3, r * 0.1,
      node.x, node.y, r,
    )
    grad.addColorStop(0, innerColor)
    grad.addColorStop(1, outerColor)
    ctx.fillStyle = grad
  } else {
    // Flat fill (classic style)
    ctx.fillStyle = innerColor
  }
  ctx.fill()

  // Border
  ctx.strokeStyle = theme.spiderBorderColor ?? outerColor
  ctx.lineWidth = theme.useGradient ? 1.5 : 2
  ctx.stroke()

  // Phase label
  const label = phaseToString(node.phase)
  if (label) {
    ctx.font = '13px system-ui, sans-serif'
    ctx.fillStyle = theme.phaseLabelColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, node.x, node.y)
  }

  // Identity removal X overlay (proof mode)
  if (isIdRemoval) {
    const arm = r * 0.25
    ctx.lineCap = 'round'
    // Dark outline
    ctx.strokeStyle = isOverXHitbox ? '#8b1a1a' : 'rgba(139,26,26,0.35)'
    ctx.lineWidth = isOverXHitbox ? 5 : 4
    ctx.beginPath()
    ctx.moveTo(node.x - arm, node.y - arm)
    ctx.lineTo(node.x + arm, node.y + arm)
    ctx.moveTo(node.x + arm, node.y - arm)
    ctx.lineTo(node.x - arm, node.y + arm)
    ctx.stroke()
    // Bright red on top
    ctx.strokeStyle = isOverXHitbox ? '#e83030' : 'rgba(196,43,43,0.4)'
    ctx.lineWidth = isOverXHitbox ? 3 : 2
    ctx.beginPath()
    ctx.moveTo(node.x - arm, node.y - arm)
    ctx.lineTo(node.x + arm, node.y + arm)
    ctx.moveTo(node.x + arm, node.y - arm)
    ctx.lineTo(node.x - arm, node.y + arm)
    ctx.stroke()
  }
}

function drawBoundaryNode(
  ctx: CanvasRenderingContext2D,
  node: Node,
  isSelected: boolean,
  isHovered: boolean,
  selectionPulse: number,
  isWireTarget: boolean = false,
  isRewriteHighlighted: boolean = false,
): void {
  const theme = getCanvasTheme()
  const r = BOUNDARY_RADIUS

  // Wire target glow (connection candidate)
  if (isWireTarget) {
    ctx.beginPath()
    ctx.arc(node.x, node.y, r + 7, 0, Math.PI * 2)
    ctx.fillStyle = theme.wireTargetGlow
    ctx.fill()
  }

  // Rewrite match glow (amber)
  if (isRewriteHighlighted && !isWireTarget) {
    ctx.beginPath()
    ctx.arc(node.x, node.y, r + 7, 0, Math.PI * 2)
    ctx.fillStyle = theme.rewriteMatchGlow
    ctx.fill()
  }

  if (isSelected) {
    const glowAlpha = 0.35 + 0.2 * selectionPulse
    ctx.beginPath()
    ctx.arc(node.x, node.y, r + 5, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(80, 140, 255, ${glowAlpha})`
    ctx.fill()
  } else if (isHovered && !isWireTarget) {
    ctx.beginPath()
    ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2)
    ctx.fillStyle = theme.hoverGlow
    ctx.fill()
  }

  ctx.beginPath()
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
  ctx.fillStyle = theme.boundaryColor
  ctx.fill()
}

/** Draw ghost edges (removed edges still fading out). */
export function drawGhostEdges(
  ctx: CanvasRenderingContext2D,
  ghostEdges: GhostEdge[],
): void {
  const theme = getCanvasTheme()
  for (const ghost of ghostEdges) {
    const opacity = ghost.anim.opacity.value
    if (opacity <= 0.01) continue

    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity))

    ctx.beginPath()
    ctx.moveTo(ghost.source.x, ghost.source.y)
    ctx.lineTo(ghost.target.x, ghost.target.y)
    ctx.strokeStyle = theme.edgeColor
    ctx.lineWidth = EDGE_WIDTH
    ctx.stroke()

    if (ghost.type === EdgeType.Hadamard) {
      const mx = (ghost.source.x + ghost.target.x) / 2
      const my = (ghost.source.y + ghost.target.y) / 2
      drawHadamardBox(ctx, mx, my)
    }

    ctx.restore()
  }
}
