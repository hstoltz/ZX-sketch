import type { GraphData, Edge } from '../model/types.ts'
import { NodeType, EdgeType } from '../model/types.ts'
import { phaseToString } from '../model/Phase.ts'
import { SPIDER_RADIUS } from '../canvas/elements.ts'
import { getCanvasTheme } from '../theme/ThemeManager.ts'

const BOUNDARY_RADIUS = 5
const HADAMARD_BOX_SIZE = 10
const EDGE_WIDTH = 2.2
const SELF_LOOP_SIZE = 48
const MULTI_EDGE_SPACING = 14
const PADDING = 40

function computeBounds(graph: GraphData) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const node of graph.nodes.values()) {
    minX = Math.min(minX, node.x - SPIDER_RADIUS)
    minY = Math.min(minY, node.y - SPIDER_RADIUS - 20) // extra for phase labels
    maxX = Math.max(maxX, node.x + SPIDER_RADIUS)
    maxY = Math.max(maxY, node.y + SPIDER_RADIUS)
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 200; maxY = 200 }
  return {
    minX: minX - PADDING,
    minY: minY - PADDING,
    maxX: maxX + PADDING,
    maxY: maxY + PADDING,
    width: (maxX - minX) + 2 * PADDING,
    height: (maxY - minY) + 2 * PADDING,
  }
}

/** Escape XML entities. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function groupEdges(graph: GraphData) {
  const map = new Map<string, { edges: Edge[]; sourceId: string; targetId: string }>()
  for (const edge of graph.edges.values()) {
    const a = edge.source < edge.target ? edge.source : edge.target
    const b = edge.source < edge.target ? edge.target : edge.source
    const isSelfLoop = edge.source === edge.target
    const key = isSelfLoop ? `self:${edge.source}` : `${a}:${b}`
    if (!map.has(key)) {
      map.set(key, { edges: [], sourceId: edge.source, targetId: edge.target })
    }
    map.get(key)!.edges.push(edge)
  }
  return map
}

function hadamardBox(x: number, y: number, hFill: string, hStroke: string): string {
  const s = HADAMARD_BOX_SIZE
  return `  <rect x="${(x - s / 2).toFixed(1)}" y="${(y - s / 2).toFixed(1)}" width="${s}" height="${s}" fill="${hFill}" stroke="${hStroke}" stroke-width="1.2"/>`
}

/**
 * Export a ZX graph as an SVG string.
 * Mirrors the canvas rendering with matching colors and layout.
 * @param transparent If true, omit the background fill (for inline previews).
 */
export function exportSVG(graph: GraphData, transparent = false): string {
  const theme = getCanvasTheme()
  const bounds = computeBounds(graph)
  const lines: string[] = []

  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX.toFixed(1)} ${bounds.minY.toFixed(1)} ${bounds.width.toFixed(1)} ${bounds.height.toFixed(1)}" width="${bounds.width.toFixed(0)}" height="${bounds.height.toFixed(0)}">`)
  if (!transparent) {
    lines.push(`  <rect x="${bounds.minX.toFixed(1)}" y="${bounds.minY.toFixed(1)}" width="${bounds.width.toFixed(1)}" height="${bounds.height.toFixed(1)}" fill="${theme.bgColor}"/>`)
  }

  // Defs — gradient or flat
  lines.push('  <defs>')
  if (theme.useGradient) {
    lines.push('    <radialGradient id="zGrad" cx="35%" cy="35%" r="65%">')
    lines.push(`      <stop offset="0%" stop-color="${theme.zInner}"/>`)
    lines.push(`      <stop offset="100%" stop-color="${theme.zOuter}"/>`)
    lines.push('    </radialGradient>')
    lines.push('    <radialGradient id="xGrad" cx="35%" cy="35%" r="65%">')
    lines.push(`      <stop offset="0%" stop-color="${theme.xInner}"/>`)
    lines.push(`      <stop offset="100%" stop-color="${theme.xOuter}"/>`)
    lines.push('    </radialGradient>')
  }
  lines.push('  </defs>')

  // --- Edges ---
  const edgeGroups = groupEdges(graph)

  for (const [, group] of edgeGroups) {
    const source = graph.nodes.get(group.sourceId)
    const target = graph.nodes.get(group.targetId)
    if (!source || !target) continue

    const isSelfLoop = group.sourceId === group.targetId
    const count = group.edges.length

    for (let i = 0; i < count; i++) {
      const edge = group.edges[i]

      if (isSelfLoop) {
        const baseAngle = -Math.PI / 2
        const angleSpread = count > 1 ? Math.PI / 3 : 0
        const angle = baseAngle + (i - (count - 1) / 2) * angleSpread
        const loopDist = SELF_LOOP_SIZE
        const spread = 0.65
        const cp1x = source.x + Math.cos(angle - spread) * loopDist
        const cp1y = source.y + Math.sin(angle - spread) * loopDist
        const cp2x = source.x + Math.cos(angle + spread) * loopDist
        const cp2y = source.y + Math.sin(angle + spread) * loopDist

        lines.push(`  <path d="M ${source.x.toFixed(1)} ${source.y.toFixed(1)} C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${source.x.toFixed(1)} ${source.y.toFixed(1)}" fill="none" stroke="${theme.edgeColor}" stroke-width="${EDGE_WIDTH}"/>`)

        if (edge.type === EdgeType.Hadamard) {
          const hmx = source.x * 0.125 + cp1x * 0.375 + cp2x * 0.375 + source.x * 0.125
          const hmy = source.y * 0.125 + cp1y * 0.375 + cp2y * 0.375 + source.y * 0.125
          lines.push(hadamardBox(hmx, hmy, theme.hadamardFill, theme.hadamardStroke))
        }
      } else if (count === 1) {
        lines.push(`  <line x1="${source.x.toFixed(1)}" y1="${source.y.toFixed(1)}" x2="${target.x.toFixed(1)}" y2="${target.y.toFixed(1)}" stroke="${theme.edgeColor}" stroke-width="${EDGE_WIDTH}"/>`)

        if (edge.type === EdgeType.Hadamard) {
          const mx = (source.x + target.x) / 2
          const my = (source.y + target.y) / 2
          lines.push(hadamardBox(mx, my, theme.hadamardFill, theme.hadamardStroke))
        }
      } else {
        const dx = target.x - source.x
        const dy = target.y - source.y
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const px = -dy / len
        const py = dx / len
        const offset = (i - (count - 1) / 2) * MULTI_EDGE_SPACING
        const mx = (source.x + target.x) / 2 + px * offset * 2
        const my = (source.y + target.y) / 2 + py * offset * 2

        lines.push(`  <path d="M ${source.x.toFixed(1)} ${source.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)}, ${target.x.toFixed(1)} ${target.y.toFixed(1)}" fill="none" stroke="${theme.edgeColor}" stroke-width="${EDGE_WIDTH}"/>`)

        if (edge.type === EdgeType.Hadamard) {
          const hmx = source.x * 0.25 + mx * 0.5 + target.x * 0.25
          const hmy = source.y * 0.25 + my * 0.5 + target.y * 0.25
          lines.push(hadamardBox(hmx, hmy, theme.hadamardFill, theme.hadamardStroke))
        }
      }
    }
  }

  // --- Nodes ---
  for (const node of graph.nodes.values()) {
    if (node.type === NodeType.Boundary) {
      lines.push(`  <circle cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="${BOUNDARY_RADIUS}" fill="${theme.boundaryColor}"/>`)
    } else {
      const isZ = node.type === NodeType.Z
      const borderColor = theme.spiderBorderColor ?? (isZ ? theme.zOuter : theme.xOuter)
      const strokeWidth = theme.useGradient ? '1.5' : '2'
      if (theme.useGradient) {
        const gradId = isZ ? 'zGrad' : 'xGrad'
        lines.push(`  <circle cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="${SPIDER_RADIUS}" fill="url(#${gradId})" stroke="${borderColor}" stroke-width="${strokeWidth}"/>`)
      } else {
        const fill = isZ ? theme.zInner : theme.xInner
        lines.push(`  <circle cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="${SPIDER_RADIUS}" fill="${fill}" stroke="${borderColor}" stroke-width="${strokeWidth}"/>`)
      }

      const label = phaseToString(node.phase)
      if (label) {
        lines.push(`  <text x="${node.x.toFixed(1)}" y="${(node.y - SPIDER_RADIUS - 4).toFixed(1)}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" fill="${theme.phaseLabelColor}">${esc(label)}</text>`)
      }
    }
  }

  lines.push('</svg>')
  return lines.join('\n')
}
