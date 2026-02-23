import type { Proof } from '../proof/ProofModel.ts'
import type { GraphData, Edge } from '../model/types.ts'
import { NodeType, EdgeType } from '../model/types.ts'

const GRID_SCALE = 80       // World pixels → circuit-space units
const TARGET_WIDTH = 4      // Target max diagram width (cm)
const TARGET_HEIGHT = 3     // Target max diagram height (cm)
const MIN_SCALE = 0.4       // Minimum cm per layout unit
const MAX_SCALE = 1.5       // Maximum cm per layout unit
const STEPS_PER_LINE = 2    // Equality steps before wrapping to next line
const LAYER_GAP = 1.5       // Horizontal gap between BFS layers (layout units)
const NODE_GAP = 1.0        // Vertical gap within a layer (layout units)

/** Standard abbreviations for ZX rules, as used in papers. */
const RULE_ABBREV: Record<string, string> = {
  spider_fusion: 'f',
  id_removal: 'id',
  bialgebra: 'bi',
  bialgebra_op: 'bi',
  hopf: 'h',
  copy: 'cp',
  color_change: 'cc',
  self_loops: 'sl',
  unfuse: 'uf',
  push_pauli: '\\pi',
  decompose_hadamard: 'eu',
  gadgetize: 'gd',
  wire_vertex: 'wv',
  lcomp: 'lc',
  pivot: 'pv',
  pivot_boundary: 'pvb',
  pivot_gadget: 'pvg',
  phase_gadget_fuse: 'pgf',
  supplementarity: 'su',
  spider_simp: 'simp',
  bialg_simp: 'simp',
  phase_free_simp: 'simp',
  basic_simp: 'simp',
  lcomp_simp: 'simp',
  pivot_simp: 'simp',
  pivot_boundary_simp: 'simp',
  pivot_gadget_simp: 'simp',
  gadget_simp: 'simp',
  supplementarity_simp: 'simp',
  clifford_simp: 'cliff',
  to_graph_like: 'gl',
  to_gh: 'gh',
  to_rg: 'rg',
  to_clifford_normal_form: 'cnf',
  full_reduce: 'simp',
  teleport_reduce: 'tel',
  interior_clifford_simp: 'int',
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Convert a phase {n, d} to compact inline LaTeX (uses \tfrac for small fractions). */
function phaseToLatex(phase: { n: number; d: number }): string {
  if (phase.n === 0) return ''
  if (phase.d === 1) {
    if (phase.n === 1) return '$\\pi$'
    return `$${phase.n}\\pi$`
  }
  if (phase.n === 1) return `$\\tfrac{\\pi}{${phase.d}}$`
  return `$\\tfrac{${phase.n}\\pi}{${phase.d}}$`
}

function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}~^]/g, c => '\\' + c)
}

// ── Proof layout ─────────────────────────────────────────────────────

/**
 * Compute proof-friendly node positions using BFS layering.
 *
 * When the graph has input/output boundaries:
 *   - Inputs are placed on the left (layer 0)
 *   - Outputs on the right (last layer)
 *   - Interior nodes are layered by BFS distance from inputs
 *   - Within each layer, nodes are ordered by their canvas y-position
 *     (preserves qubit ordering from the editor)
 *
 * Falls back to normalized canvas positions for graphs without I/O.
 */
function proofLayout(graph: GraphData): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  if (graph.nodes.size === 0) return pos

  // No I/O boundaries → use canvas positions, normalized to origin
  if (graph.inputs.length === 0 && graph.outputs.length === 0) {
    let minX = Infinity, minY = Infinity
    for (const node of graph.nodes.values()) {
      minX = Math.min(minX, node.x)
      minY = Math.min(minY, node.y)
    }
    for (const [id, node] of graph.nodes) {
      pos.set(id, { x: (node.x - minX) / GRID_SCALE, y: (node.y - minY) / GRID_SCALE })
    }
    return pos
  }

  const outputSet = new Set(graph.outputs)

  // Build undirected adjacency list
  const adj = new Map<string, string[]>()
  for (const id of graph.nodes.keys()) adj.set(id, [])
  for (const edge of graph.edges.values()) {
    if (edge.source !== edge.target) {
      adj.get(edge.source)?.push(edge.target)
      adj.get(edge.target)?.push(edge.source)
    }
  }

  // BFS from inputs (or outputs if no inputs exist)
  const layerOf = new Map<string, number>()
  const queue: string[] = []
  const starts = graph.inputs.length > 0 ? graph.inputs : graph.outputs

  for (const id of starts) {
    if (graph.nodes.has(id) && !layerOf.has(id)) {
      layerOf.set(id, 0)
      queue.push(id)
    }
  }

  let qi = 0
  while (qi < queue.length) {
    const v = queue[qi++]
    for (const u of (adj.get(v) ?? [])) {
      if (!layerOf.has(u)) {
        layerOf.set(u, layerOf.get(v)! + 1)
        queue.push(u)
      }
    }
  }

  // Assign unreached (disconnected) nodes to the middle layer
  const reachedMax = Math.max(0, ...Array.from(layerOf.values()))
  for (const id of graph.nodes.keys()) {
    if (!layerOf.has(id)) layerOf.set(id, Math.max(1, Math.round(reachedMax / 2)))
  }

  // Push output boundaries to the rightmost layer
  if (graph.inputs.length > 0 && graph.outputs.length > 0) {
    let maxInterior = 0
    for (const [id, l] of layerOf) {
      if (!outputSet.has(id)) maxInterior = Math.max(maxInterior, l)
    }
    const outLayer = Math.max(maxInterior + 1, 1)
    for (const id of graph.outputs) {
      if (graph.nodes.has(id)) layerOf.set(id, outLayer)
    }
  }

  // Group nodes by layer
  const layers = new Map<number, string[]>()
  for (const [id, l] of layerOf) {
    if (!layers.has(l)) layers.set(l, [])
    layers.get(l)!.push(id)
  }

  // Sort within each layer by canvas y (preserves qubit ordering)
  for (const nodeIds of layers.values()) {
    nodeIds.sort((a, b) => graph.nodes.get(a)!.y - graph.nodes.get(b)!.y)
  }

  // Assign coordinates: x by layer, y centered within layer
  for (const [l, nodeIds] of layers) {
    const x = l * LAYER_GAP
    const h = (nodeIds.length - 1) * NODE_GAP
    for (let i = 0; i < nodeIds.length; i++) {
      pos.set(nodeIds[i], { x, y: i * NODE_GAP - h / 2 })
    }
  }

  return pos
}

// ── Layout metrics ───────────────────────────────────────────────────

interface LayoutInfo {
  pos: Map<string, { x: number; y: number }>
  minX: number
  minY: number
  width: number
  height: number
}

function computeLayoutInfo(graph: GraphData): LayoutInfo {
  const pos = proofLayout(graph)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of pos.values()) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
  }
  return {
    pos,
    minX: isFinite(minX) ? minX : 0,
    minY: isFinite(minY) ? minY : 0,
    width: isFinite(maxX) ? maxX - minX : 0,
    height: isFinite(maxY) ? maxY - minY : 0,
  }
}

/** Compute a uniform scale that fits the largest diagram in the chain. */
function computeUniformScale(layouts: LayoutInfo[]): number {
  let maxW = 0, maxH = 0
  for (const l of layouts) {
    maxW = Math.max(maxW, l.width)
    maxH = Math.max(maxH, l.height)
  }
  if (maxW < 0.01 && maxH < 0.01) return 1
  const sx = maxW > 0.01 ? TARGET_WIDTH / maxW : MAX_SCALE
  const sy = maxH > 0.01 ? TARGET_HEIGHT / maxH : MAX_SCALE
  return Math.max(MIN_SCALE, Math.min(sx, sy, MAX_SCALE))
}

// ── Single diagram → tikzpicture ─────────────────────────────────────

/**
 * Render a single ZX diagram as a tikzpicture with absolute coordinates.
 * Uses the provided layout positions and scale for consistency across
 * multiple diagrams in a proof chain.
 */
function graphToTikzPicture(graph: GraphData, layout: LayoutInfo, scale: number): string {
  if (graph.nodes.size === 0) return '\\begin{tikzpicture}\\end{tikzpicture}'

  const { pos, minX, minY } = layout

  // Sequential labels
  const idToLabel = new Map<string, string>()
  let idx = 0
  for (const id of graph.nodes.keys()) {
    idToLabel.set(id, `v${idx++}`)
  }

  const lines: string[] = []
  lines.push(`\\begin{tikzpicture}[baseline=(current bounding box.center), scale=${scale.toFixed(2)}, every node/.style={transform shape}]`)

  // ── Nodes ──
  for (const [id, node] of graph.nodes) {
    const label = idToLabel.get(id)!
    const p = pos.get(id)!
    const x = (p.x - minX).toFixed(2)
    const y = (-(p.y - minY)).toFixed(2) // flip Y for LaTeX (Y-up)

    let style: string
    let content: string
    switch (node.type) {
      case NodeType.Z:
        style = node.phase.n !== 0 ? 'zxPhaseZ' : 'zxSpiderZ'
        content = phaseToLatex(node.phase)
        break
      case NodeType.X:
        style = node.phase.n !== 0 ? 'zxPhaseX' : 'zxSpiderX'
        content = phaseToLatex(node.phase)
        break
      case NodeType.Boundary:
      default:
        style = 'zxBound'
        content = ''
        break
    }

    lines.push(`  \\node[${style}] (${label}) at (${x}, ${y}) {${content}};`)
  }

  // ── Edges ──
  // Group by endpoint pair for multi-edge handling
  const edgeGroups = new Map<string, { edges: Edge[]; sLabel: string; tLabel: string }>()
  for (const edge of graph.edges.values()) {
    const sL = idToLabel.get(edge.source)!
    const tL = idToLabel.get(edge.target)!
    const self = edge.source === edge.target
    const key = self
      ? `self:${sL}`
      : (sL < tL ? `${sL}:${tL}` : `${tL}:${sL}`)

    if (!edgeGroups.has(key)) edgeGroups.set(key, { edges: [], sLabel: sL, tLabel: tL })
    edgeGroups.get(key)!.edges.push(edge)
  }

  for (const [, group] of edgeGroups) {
    const { edges, sLabel, tLabel } = group
    const self = sLabel === tLabel
    const count = edges.length

    for (let i = 0; i < count; i++) {
      const edge = edges[i]
      const had = edge.type === EdgeType.Hadamard
        ? ' node[zxHad, midway] {}'
        : ''

      if (self) {
        const dirs = ['above', 'below', 'left', 'right']
        lines.push(`  \\draw (${sLabel}) to[loop ${dirs[i % 4]}]${had} (${sLabel});`)
      } else if (count === 1) {
        lines.push(`  \\draw (${sLabel}) --${had} (${tLabel});`)
      } else {
        // Spread parallel edges with bends
        const bendAngle = (i - (count - 1) / 2) * 25
        if (Math.abs(bendAngle) < 1) {
          lines.push(`  \\draw (${sLabel}) to${had} (${tLabel});`)
        } else {
          const dir = bendAngle > 0 ? 'left' : 'right'
          lines.push(`  \\draw (${sLabel}) to[bend ${dir}=${Math.abs(bendAngle).toFixed(0)}]${had} (${tLabel});`)
        }
      }
    }
  }

  lines.push('\\end{tikzpicture}')
  return lines.join('\n')
}

// ── Proof export ─────────────────────────────────────────────────────

/** Export a proof as a self-contained LaTeX document using zx-calculus TikZ. */
export function exportProofLaTeX(proof: Proof): string {
  const lines: string[] = []

  // Preamble
  lines.push('\\documentclass{article}')
  lines.push('\\usepackage[margin=0.5in]{geometry}')
  lines.push('\\usepackage{tikz}')
  lines.push('\\usetikzlibrary{zx-calculus}')
  lines.push('\\usepackage{amsmath}')
  lines.push('\\pagestyle{empty}')
  lines.push('')
  // Node styles using zx-calculus package colors
  lines.push('\\tikzset{')
  lines.push('  zxSpiderZ/.style={circle, draw=zx_green!80!black, fill=zx_green!25!white, minimum size=2mm, inner sep=1pt},')
  lines.push('  zxSpiderX/.style={circle, draw=zx_red!80!black, fill=zx_red!25!white, minimum size=2mm, inner sep=1pt},')
  lines.push('  zxPhaseZ/.style={zxSpiderZ, minimum size=4mm, font=\\footnotesize},')
  lines.push('  zxPhaseX/.style={zxSpiderX, minimum size=4mm, font=\\footnotesize},')
  lines.push('  zxBound/.style={circle, draw=black, fill=white, inner sep=0pt, minimum size=1.5mm},')
  lines.push('  zxHad/.style={rectangle, draw=yellow!60!black, fill=yellow!30!white, minimum size=2.5mm, inner sep=0pt},')
  lines.push('}')
  lines.push('')
  lines.push('% \\zxeq{rule} produces an = sign with (rule) as superscript')
  lines.push('\\newcommand{\\zxeq}[1]{\\overset{\\scriptscriptstyle\\mathrm{(#1)}}{=}}')
  lines.push('')
  lines.push('\\begin{document}')

  const allGraphs = [proof.initialGraph, ...proof.steps.map(s => s.graph)]

  // Pre-compute layouts for all diagrams
  const layouts = allGraphs.map(g => computeLayoutInfo(g))

  // Uniform scale across the entire proof chain
  const scale = computeUniformScale(layouts)

  // No steps — just show the diagram
  if (proof.steps.length === 0) {
    lines.push('\\[')
    lines.push(graphToTikzPicture(allGraphs[0], layouts[0], scale))
    lines.push('\\]')
    lines.push('\\end{document}')
    return lines.join('\n') + '\n'
  }

  // Proof chain in align*
  lines.push('% Paste the align* block into your paper')
  lines.push('\\begin{align*}')

  let stepsOnLine = 0

  for (let i = 0; i < allGraphs.length; i++) {
    const diagram = graphToTikzPicture(allGraphs[i], layouts[i], scale)

    if (i === 0) {
      lines.push(`  ${diagram}`)
    } else {
      const step = proof.steps[i - 1]
      const abbrev = RULE_ABBREV[step.ruleId] ?? escapeLatex(step.label ?? step.ruleName)

      lines.push(stepsOnLine === 0 ? `  &\\zxeq{${abbrev}}` : `  \\zxeq{${abbrev}}`)
      lines.push(`  ${diagram}`)
      stepsOnLine++

      if (stepsOnLine >= STEPS_PER_LINE && i < allGraphs.length - 1) {
        lines.push('  \\\\')
        stepsOnLine = 0
      }
    }
  }

  lines.push('\\end{align*}')
  lines.push('\\end{document}')
  return lines.join('\n') + '\n'
}
