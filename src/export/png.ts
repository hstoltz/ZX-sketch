import type { GraphData } from '../model/types.ts'
import { drawEdges, drawNodes, SPIDER_RADIUS } from '../canvas/elements.ts'

const BG_COLOR = '#f8f8f5'
const PADDING = 50

function computeBounds(graph: GraphData) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const node of graph.nodes.values()) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x)
    maxY = Math.max(maxY, node.y)
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 200; maxY = 200 }
  return {
    minX: minX - PADDING,
    minY: minY - PADDING - 20, // extra for phase labels above nodes
    maxX: maxX + PADDING + SPIDER_RADIUS,
    maxY: maxY + PADDING + SPIDER_RADIUS,
  }
}

/**
 * Render the graph to an off-screen canvas and download as PNG.
 * @param scale Pixel density multiplier (default 2 for retina-quality).
 */
export function exportPNG(graph: GraphData, scale: number = 2): void {
  const bounds = computeBounds(graph)
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY

  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale

  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.translate(-bounds.minX, -bounds.minY)

  // Background
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(bounds.minX, bounds.minY, width, height)

  // Draw graph — no selection, no hover, no animations
  drawEdges(ctx, graph, new Set(), null)
  drawNodes(ctx, graph, new Set(), null, 0, null, null, null)

  // Download via blob
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'diagram.png'
    a.click()
    URL.revokeObjectURL(url)
  }, 'image/png')
}
