// LearnOverlay.ts — "Learn more" overlay with all 19 rewrite rule diagrams

import { getCanvasTheme } from '../theme/ThemeManager.ts'

const NS = 'http://www.w3.org/2000/svg'

// --- SVG helpers ---

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  return el
}

function zNode(cx: number, cy: number, r: number, phase?: string): SVGElement {
  const theme = getCanvasTheme()
  const g = svgEl('g', {})
  g.appendChild(svgEl('circle', { cx, cy, r, fill: theme.zInner, stroke: theme.spiderBorderColor ?? theme.zOuter, 'stroke-width': 1.5 }))
  if (phase) {
    const t = svgEl('text', {
      x: cx, y: cy + 4, 'text-anchor': 'middle', fill: theme.phaseLabelColor,
      'font-size': 10, 'font-weight': 600, 'font-family': 'system-ui, sans-serif',
    })
    t.textContent = phase
    g.appendChild(t)
  }
  return g
}

function xNode(cx: number, cy: number, r: number, phase?: string): SVGElement {
  const theme = getCanvasTheme()
  const g = svgEl('g', {})
  g.appendChild(svgEl('circle', { cx, cy, r, fill: theme.xInner, stroke: theme.spiderBorderColor ?? theme.xOuter, 'stroke-width': 1.5 }))
  if (phase) {
    const t = svgEl('text', {
      x: cx, y: cy + 4, 'text-anchor': 'middle', fill: theme.phaseLabelColor,
      'font-size': 10, 'font-weight': 600, 'font-family': 'system-ui, sans-serif',
    })
    t.textContent = phase
    g.appendChild(t)
  }
  return g
}

function bNode(cx: number, cy: number): SVGElement {
  return svgEl('circle', { cx, cy, r: 3.5, fill: getCanvasTheme().boundaryColor })
}

function wire(x1: number, y1: number, x2: number, y2: number): SVGElement {
  return svgEl('line', { x1, y1, x2, y2, stroke: getCanvasTheme().edgeColor, 'stroke-width': 1.5 })
}

function hEdge(x1: number, y1: number, x2: number, y2: number): SVGElement {
  const theme = getCanvasTheme()
  const g = svgEl('g', {})
  g.appendChild(svgEl('line', { x1, y1, x2, y2, stroke: theme.edgeColor, 'stroke-width': 1.5 }))
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
  g.appendChild(svgEl('rect', {
    x: mx - 5, y: my - 5, width: 10, height: 10,
    fill: theme.hadamardFill, stroke: theme.hadamardStroke, 'stroke-width': 1,
  }))
  return g
}

function selfLoop(cx: number, cy: number, r: number): SVGElement {
  // Draw a loop above the node
  const g = svgEl('g', {})
  g.appendChild(svgEl('ellipse', {
    cx, cy: cy - r - 8, rx: 8, ry: 8,
    fill: 'none', stroke: getCanvasTheme().edgeColor, 'stroke-width': 1.5,
  }))
  return g
}

function equalsSign(x: number, y: number): SVGElement {
  const t = svgEl('text', {
    x, y: y + 5, 'text-anchor': 'middle', fill: '#999',
    'font-size': 16, 'font-weight': 700, 'font-family': 'system-ui, sans-serif',
  })
  t.textContent = '='
  return t
}

// --- Diagram builder ---

interface RuleSpec {
  name: string
  category: 'basic' | 'graph_like'
  description: string
  link?: string
  tikzFiles?: { lhs: string; rhs: string; lhsH: number; rhsH: number }   // split LHS / RHS TikZ SVGs (H = viewBox height)
  buildDiagram: (svg: SVGElement) => void
}

const RULES: RuleSpec[] = [
  // ──── BASIC ────
  {
    name: 'Spider Fusion',
    category: 'basic',
    tikzFiles: { lhs: 'spider-fusion-lhs.svg', rhs: 'spider-fusion-rhs.svg', lhsH: 23.692, rhsH: 23.692 },
    description: 'Two spiders of the same color can be combined together, and their phases will add.  <span class="learn-action">Drag two spiders together to fuse!</span>',
    buildDiagram(svg) {
      // LHS: two Z spiders connected
      svg.appendChild(wire(20, 30, 45, 30))
      svg.appendChild(wire(75, 30, 100, 30))
      svg.appendChild(wire(45, 30, 75, 30))
      svg.appendChild(zNode(45, 30, 11, '\u03B1'))
      svg.appendChild(zNode(75, 30, 11, '\u03B2'))
      // =
      svg.appendChild(equalsSign(130, 28))
      // RHS: one Z spider
      svg.appendChild(wire(150, 30, 175, 30))
      svg.appendChild(wire(175, 30, 200, 30))
      svg.appendChild(zNode(175, 30, 12, '\u03B1+\u03B2'))
    },
  },
  {
    name: 'Identity Removal',
    category: 'basic',
    tikzFiles: { lhs: 'identity-removal-lhs.svg', rhs: 'identity-removal-rhs.svg', lhsH: 23.692, rhsH: 23.692 },
    description: 'A spider with phase of 0 can be removed from a wire.  We call these "identity wires" since they do nothing.  <span class="learn-action">Hover over an identity wire and click the red "x" to remove it!</span>',
    buildDiagram(svg) {
      // LHS: boundary — Z(0) — boundary
      svg.appendChild(wire(20, 30, 60, 30))
      svg.appendChild(wire(60, 30, 100, 30))
      svg.appendChild(bNode(20, 30))
      svg.appendChild(zNode(60, 30, 10))
      svg.appendChild(bNode(100, 30))
      // =
      svg.appendChild(equalsSign(130, 28))
      // RHS: straight wire
      svg.appendChild(wire(155, 30, 205, 30))
      svg.appendChild(bNode(155, 30))
      svg.appendChild(bNode(205, 30))
    },
  },
  {
    name: 'Bialgebra',
    category: 'basic',
    tikzFiles: { lhs: 'bialgebra-lhs.svg', rhs: 'bialgebra-rhs.svg', lhsH: 39.681, rhsH: 39.681 },
    description: 'A Z-X pair (red and green spider) connected by a blank wire can expand into a bipartite pair.  <span class="learn-action">Conversely, you can "pop the square" and go in the other direction to simplify.</span>',
    buildDiagram(svg) {
      // LHS: Z — X
      svg.appendChild(wire(20, 18, 42, 30))
      svg.appendChild(wire(20, 42, 42, 30))
      svg.appendChild(wire(42, 30, 72, 30))
      svg.appendChild(wire(72, 30, 100, 18))
      svg.appendChild(wire(72, 30, 100, 42))
      svg.appendChild(zNode(42, 30, 10))
      svg.appendChild(xNode(72, 30, 10))
      // =
      svg.appendChild(equalsSign(125, 28))
      // RHS: bipartite 2×2
      svg.appendChild(wire(145, 18, 160, 18))
      svg.appendChild(wire(145, 42, 160, 42))
      svg.appendChild(wire(160, 18, 190, 18))
      svg.appendChild(wire(160, 18, 190, 42))
      svg.appendChild(wire(160, 42, 190, 18))
      svg.appendChild(wire(160, 42, 190, 42))
      svg.appendChild(wire(190, 18, 210, 18))
      svg.appendChild(wire(190, 42, 210, 42))
      svg.appendChild(xNode(160, 18, 8))
      svg.appendChild(xNode(160, 42, 8))
      svg.appendChild(zNode(190, 18, 8))
      svg.appendChild(zNode(190, 42, 8))
    },
  },
  {
    name: 'Hopf Rule',
    category: 'basic',
    tikzFiles: { lhs: 'hopf-rule-lhs.svg', rhs: 'hopf-rule-rhs.svg', lhsH: 28.224, rhsH: 28.224 },
    description: 'If two spiders of different colors are connected by parallel wires, you can cut them both.  <span class="learn-action">If you see a red dotted line between two spiders, click it to cut!</span>',
    buildDiagram(svg) {
      // LHS: Z — 2×H — X
      svg.appendChild(wire(18, 30, 42, 30))
      svg.appendChild(wire(78, 30, 102, 30))
      svg.appendChild(hEdge(42, 22, 78, 22))
      svg.appendChild(hEdge(42, 38, 78, 38))
      svg.appendChild(zNode(42, 30, 10))
      svg.appendChild(xNode(78, 30, 10))
      // =
      svg.appendChild(equalsSign(128, 28))
      // RHS: disconnected Z, X
      svg.appendChild(wire(148, 30, 165, 30))
      svg.appendChild(zNode(165, 30, 10))
      svg.appendChild(wire(190, 30, 207, 30))
      svg.appendChild(xNode(190, 30, 10))
    },
  },
  {
    name: 'Copy Rule',
    category: 'basic',
    tikzFiles: { lhs: 'copy-lhs.svg', rhs: 'copy-rhs.svg', lhsH: 39.681, rhsH: 39.681 },
    description: 'You can "copy" spiders if they are connected like so.',
    buildDiagram(svg) {
      // LHS: X — Z(0)
      svg.appendChild(wire(25, 18, 50, 30))
      svg.appendChild(wire(25, 42, 50, 30))
      svg.appendChild(wire(50, 30, 80, 30))
      svg.appendChild(xNode(50, 30, 10))
      svg.appendChild(zNode(80, 30, 8))
      // =
      svg.appendChild(equalsSign(115, 28))
      // RHS: two dangling wires
      svg.appendChild(wire(140, 18, 165, 18))
      svg.appendChild(wire(140, 42, 165, 42))
      svg.appendChild(zNode(165, 18, 8))
      svg.appendChild(zNode(165, 42, 8))
    },
  },
  {
    name: 'Color Change',
    category: 'basic',
    tikzFiles: { lhs: 'color-change-lhs.svg', rhs: 'color-change-rhs.svg', lhsH: 23.692, rhsH: 23.692 },
    description: 'Z and X spiders are symmetric. <span class="learn-action">Double tap a spider to make it change color!</span>',
    buildDiagram(svg) {
      // LHS: Z with simple edges
      svg.appendChild(wire(18, 30, 55, 30))
      svg.appendChild(wire(55, 30, 92, 30))
      svg.appendChild(zNode(55, 30, 12, '\u03B1'))
      // =
      svg.appendChild(equalsSign(120, 28))
      // RHS: X with H on each edge
      svg.appendChild(hEdge(140, 30, 175, 30))
      svg.appendChild(hEdge(175, 30, 210, 30))
      svg.appendChild(xNode(175, 30, 12, '\u03B1'))
    },
  },
  {
    name: 'Self-Loop Removal',
    category: 'basic',
    tikzFiles: { lhs: 'self-loop-removal-lhs.svg', rhs: 'self-loop-removal-rhs.svg', lhsH: 36.669, rhsH: 36.669 },
    description: 'If a spider has a wire connected to itself, you can remove it.',
    buildDiagram(svg) {
      // LHS: Z with self-loop
      svg.appendChild(wire(25, 30, 55, 30))
      svg.appendChild(wire(55, 30, 85, 30))
      svg.appendChild(selfLoop(55, 30, 10))
      svg.appendChild(zNode(55, 30, 10, '\u03B1'))
      // =
      svg.appendChild(equalsSign(115, 28))
      // RHS: Z without loop
      svg.appendChild(wire(140, 30, 170, 30))
      svg.appendChild(wire(170, 30, 200, 30))
      svg.appendChild(zNode(170, 30, 10, '\u03B1'))
    },
  },
  {
    name: 'Unfuse (Split)',
    category: 'basic',
    tikzFiles: { lhs: 'unfuse-lhs.svg', rhs: 'unfuse-rhs.svg', lhsH: 23.692, rhsH: 23.692 },
    description: 'You can break spiders apart.  The phases of the new spiders will sum up to the original phase.  <span class="learn-action">Right click spiders to split them!</span>',
    buildDiagram(svg) {
      // LHS: one Z spider
      svg.appendChild(wire(20, 30, 50, 30))
      svg.appendChild(wire(50, 30, 80, 30))
      svg.appendChild(zNode(50, 30, 12, '\u03B1+\u03B2'))
      // =
      svg.appendChild(equalsSign(110, 28))
      // RHS: two Z spiders
      svg.appendChild(wire(130, 30, 155, 30))
      svg.appendChild(wire(155, 30, 185, 30))
      svg.appendChild(wire(185, 30, 210, 30))
      svg.appendChild(zNode(155, 30, 11, '\u03B1'))
      svg.appendChild(zNode(185, 30, 11, '\u03B2'))
    },
  },
  {
    name: 'Pauli Push',
    category: 'basic',
    tikzFiles: { lhs: 'pauli-push-lhs.svg', rhs: 'pauli-push-rhs.svg', lhsH: 23.692, rhsH: 23.692 },
    description: 'A Pauli spider (\u03C0-phase) can be pushed through a neighboring spider, negating its phase.',
    buildDiagram(svg) {
      // LHS: Z(α) — H — Z(π)
      svg.appendChild(wire(15, 30, 42, 30))
      svg.appendChild(hEdge(42, 30, 78, 30))
      svg.appendChild(wire(78, 30, 105, 30))
      svg.appendChild(zNode(42, 30, 11, '\u03B1'))
      svg.appendChild(zNode(78, 30, 10, '\u03C0'))
      // =
      svg.appendChild(equalsSign(128, 28))
      // RHS: Z(-α) — H — ...
      svg.appendChild(wire(148, 30, 180, 30))
      svg.appendChild(wire(180, 30, 210, 30))
      svg.appendChild(zNode(180, 30, 12, '-\u03B1'))
    },
  },
  {
    name: 'Euler Decomposition',
    category: 'basic',
    tikzFiles: { lhs: 'euler-decomposition-lhs.svg', rhs: 'euler-decomposition-rhs.svg', lhsH: 23.692, rhsH: 23.692 },
    description: 'Hadamard edges are just special symbols for three spiders next to each other with phases: Z(\u03C0/2), X(\u03C0/2), and Z(\u03C0/2).',
    buildDiagram(svg) {
      // LHS: H edge
      svg.appendChild(hEdge(25, 30, 75, 30))
      svg.appendChild(bNode(25, 30))
      svg.appendChild(bNode(75, 30))
      // =
      svg.appendChild(equalsSign(103, 28))
      // RHS: three spider chain
      svg.appendChild(wire(120, 30, 140, 30))
      svg.appendChild(wire(140, 30, 165, 30))
      svg.appendChild(wire(165, 30, 190, 30))
      svg.appendChild(wire(190, 30, 210, 30))
      const lbl = '\u03C0/2'
      svg.appendChild(zNode(140, 30, 10, lbl))
      svg.appendChild(xNode(165, 30, 10, lbl))
      svg.appendChild(zNode(190, 30, 10, lbl))
    },
  },
  {
    name: 'Gadgetize',
    category: 'basic',
    tikzFiles: { lhs: 'gadgetize-lhs.svg', rhs: 'gadgetize-rhs.svg', lhsH: 55.67, rhsH: 55.67 },
    description: 'This is a special case of splitting apart spiders.',
    buildDiagram(svg) {
      // LHS: Z(α) spider
      svg.appendChild(wire(25, 30, 55, 30))
      svg.appendChild(wire(55, 30, 85, 30))
      svg.appendChild(zNode(55, 30, 12, '\u03B1'))
      // =
      svg.appendChild(equalsSign(113, 28))
      // RHS: Z(0) with leaf Z(α)
      svg.appendChild(wire(130, 30, 160, 30))
      svg.appendChild(wire(160, 30, 190, 30))
      svg.appendChild(wire(160, 30, 160, 55))
      svg.appendChild(zNode(160, 30, 10))
      svg.appendChild(zNode(160, 55, 9, '\u03B1'))
    },
  },
  {
    name: 'Wire Vertex',
    category: 'basic',
    tikzFiles: { lhs: 'wire-vertex-lhs.svg', rhs: 'wire-vertex-rhs.svg', lhsH: 23.692, rhsH: 23.692 },
    description: 'Since a phase 0 spider on a wire just acts as the identity, <span class="learn-action">double click a wire to add a phaseless (identity spider)!</span>',
    buildDiagram(svg) {
      // LHS: simple wire
      svg.appendChild(wire(30, 30, 90, 30))
      svg.appendChild(bNode(30, 30))
      svg.appendChild(bNode(90, 30))
      // =
      svg.appendChild(equalsSign(118, 28))
      // RHS: wire with Z(0) in middle
      svg.appendChild(wire(138, 30, 168, 30))
      svg.appendChild(wire(168, 30, 198, 30))
      svg.appendChild(bNode(138, 30))
      svg.appendChild(zNode(168, 30, 9))
      svg.appendChild(bNode(198, 30))
    },
  },

  // ──── GRAPH-LIKE ────
  {
    name: 'Local Complementation',
    category: 'graph_like',
    tikzFiles: { lhs: 'local-complementation-lhs.svg', rhs: 'local-complementation-rhs.svg', lhsH: 55.67, rhsH: 55.67 },
    description: 'A Z spider with phase \u00B1\u03C0/2 connected to neighbors via Hadamard edges can be removed, complementing the neighborhood.',
    link: 'https://zxcalculus.com/intro.html',
    buildDiagram(svg) {
      // LHS: central Z(π/2) with H-connected neighbors
      svg.appendChild(hEdge(20, 18, 55, 30))
      svg.appendChild(hEdge(20, 42, 55, 30))
      svg.appendChild(hEdge(55, 30, 90, 18))
      svg.appendChild(hEdge(55, 30, 90, 42))
      svg.appendChild(zNode(55, 30, 10, '\u00B1\u03C0/2'))
      svg.appendChild(zNode(20, 18, 7))
      svg.appendChild(zNode(20, 42, 7))
      svg.appendChild(zNode(90, 18, 7))
      svg.appendChild(zNode(90, 42, 7))
      // =
      svg.appendChild(equalsSign(120, 28))
      // RHS: neighbors fully connected (complemented)
      svg.appendChild(hEdge(145, 18, 180, 18))
      svg.appendChild(hEdge(145, 42, 180, 42))
      svg.appendChild(hEdge(145, 18, 145, 42))
      svg.appendChild(hEdge(180, 18, 180, 42))
      svg.appendChild(hEdge(145, 18, 180, 42))
      svg.appendChild(hEdge(145, 42, 180, 18))
      svg.appendChild(zNode(145, 18, 7))
      svg.appendChild(zNode(145, 42, 7))
      svg.appendChild(zNode(180, 18, 7))
      svg.appendChild(zNode(180, 42, 7))
    },
  },
  {
    name: 'Pivoting',
    category: 'graph_like',
    tikzFiles: { lhs: 'pivoting-lhs.svg', rhs: 'pivoting-rhs.svg', lhsH: 55.67, rhsH: 55.67 },
    description: 'Two adjacent Z spiders with Clifford phases and a Hadamard edge are removed, toggling edges between their neighborhoods.',
    buildDiagram(svg) {
      // LHS: two Z spiders connected by H with neighbors
      svg.appendChild(hEdge(50, 30, 85, 30))
      svg.appendChild(hEdge(20, 15, 50, 30))
      svg.appendChild(hEdge(20, 45, 50, 30))
      svg.appendChild(hEdge(85, 30, 115, 15))
      svg.appendChild(hEdge(85, 30, 115, 45))
      svg.appendChild(zNode(50, 30, 9))
      svg.appendChild(zNode(85, 30, 9))
      svg.appendChild(zNode(20, 15, 6))
      svg.appendChild(zNode(20, 45, 6))
      svg.appendChild(zNode(115, 15, 6))
      svg.appendChild(zNode(115, 45, 6))
      // =
      svg.appendChild(equalsSign(140, 28))
      // RHS: neighbors with toggled edges
      svg.appendChild(hEdge(160, 15, 190, 15))
      svg.appendChild(hEdge(160, 45, 190, 45))
      svg.appendChild(hEdge(160, 15, 190, 45))
      svg.appendChild(hEdge(160, 45, 190, 15))
      svg.appendChild(zNode(160, 15, 6))
      svg.appendChild(zNode(160, 45, 6))
      svg.appendChild(zNode(190, 15, 6))
      svg.appendChild(zNode(190, 45, 6))
    },
  },
  {
    name: 'Boundary Pivot',
    category: 'graph_like',
    tikzFiles: { lhs: 'boundary-pivot-lhs.svg', rhs: 'boundary-pivot-rhs.svg', lhsH: 55.67, rhsH: 55.67 },
    description: 'Like pivoting, but one of the two spiders is adjacent to a boundary (input/output).',
    buildDiagram(svg) {
      // LHS: boundary — Z — H — Z — neighbors
      svg.appendChild(wire(15, 30, 40, 30))
      svg.appendChild(hEdge(40, 30, 75, 30))
      svg.appendChild(hEdge(75, 30, 105, 18))
      svg.appendChild(hEdge(75, 30, 105, 42))
      svg.appendChild(bNode(15, 30))
      svg.appendChild(zNode(40, 30, 9))
      svg.appendChild(zNode(75, 30, 9))
      svg.appendChild(zNode(105, 18, 6))
      svg.appendChild(zNode(105, 42, 6))
      // =
      svg.appendChild(equalsSign(130, 28))
      // RHS
      svg.appendChild(wire(150, 30, 170, 30))
      svg.appendChild(hEdge(170, 30, 200, 18))
      svg.appendChild(hEdge(170, 30, 200, 42))
      svg.appendChild(bNode(150, 30))
      svg.appendChild(zNode(170, 30, 9))
      svg.appendChild(zNode(200, 18, 6))
      svg.appendChild(zNode(200, 42, 6))
    },
  },
  {
    name: 'Gadget Pivot',
    category: 'graph_like',
    tikzFiles: { lhs: 'gadget-pivot-lhs.svg', rhs: 'gadget-pivot-rhs.svg', lhsH: 55.67, rhsH: 55.67 },
    description: 'Like pivoting, but one of the two spiders has a phase gadget (degree-1 leaf).',
    buildDiagram(svg) {
      // LHS: Z with gadget — H — Z — neighbors
      svg.appendChild(hEdge(40, 30, 75, 30))
      svg.appendChild(hEdge(75, 30, 105, 18))
      svg.appendChild(hEdge(75, 30, 105, 42))
      svg.appendChild(wire(40, 30, 40, 55))
      svg.appendChild(zNode(40, 30, 9))
      svg.appendChild(zNode(40, 55, 7, '\u03B1'))
      svg.appendChild(zNode(75, 30, 9))
      svg.appendChild(zNode(105, 18, 6))
      svg.appendChild(zNode(105, 42, 6))
      // =
      svg.appendChild(equalsSign(130, 28))
      // RHS: simplified
      svg.appendChild(hEdge(155, 18, 185, 18))
      svg.appendChild(hEdge(155, 42, 185, 42))
      svg.appendChild(wire(155, 18, 155, 42))
      svg.appendChild(zNode(155, 18, 6))
      svg.appendChild(zNode(155, 42, 6))
      svg.appendChild(zNode(185, 18, 6))
      svg.appendChild(zNode(185, 42, 6))
    },
  },
  {
    name: 'Phase Gadget Fusion',
    category: 'graph_like',
    tikzFiles: { lhs: 'phase-gadget-fusion-lhs.svg', rhs: 'phase-gadget-fusion-rhs.svg', lhsH: 55.67, rhsH: 55.67 },
    description: 'Two phase gadgets connected to the same set of targets fuse into one gadget with summed phase.',
    buildDiagram(svg) {
      // LHS: two gadgets targeting same spiders
      svg.appendChild(hEdge(20, 18, 55, 18))
      svg.appendChild(hEdge(20, 42, 55, 42))
      svg.appendChild(hEdge(55, 18, 55, 42))
      svg.appendChild(wire(55, 18, 55, 0))
      svg.appendChild(wire(55, 42, 55, 60))
      svg.appendChild(zNode(55, 18, 7))
      svg.appendChild(zNode(55, 42, 7))
      svg.appendChild(zNode(55, 0, 7, '\u03B1'))
      svg.appendChild(zNode(55, 60, 7, '\u03B2'))
      svg.appendChild(zNode(20, 18, 6))
      svg.appendChild(zNode(20, 42, 6))
      // =
      svg.appendChild(equalsSign(100, 28))
      // RHS: one gadget
      svg.appendChild(hEdge(125, 18, 155, 30))
      svg.appendChild(hEdge(125, 42, 155, 30))
      svg.appendChild(wire(155, 30, 155, 55))
      svg.appendChild(zNode(155, 30, 7))
      svg.appendChild(zNode(155, 55, 8, '\u03B1+\u03B2'))
      svg.appendChild(zNode(125, 18, 6))
      svg.appendChild(zNode(125, 42, 6))
    },
  },
  {
    name: 'Supplementarity',
    category: 'graph_like',
    tikzFiles: { lhs: 'supplementarity-lhs.svg', rhs: 'supplementarity-rhs.svg', lhsH: 39.681, rhsH: 39.681 },
    description: 'Two Z spiders with supplementary phases (\u03B1 and -\u03B1) connected in a specific pattern can be simplified.',
    buildDiagram(svg) {
      // LHS: two Z spiders with α and -α, connected to each other and common neighbors
      svg.appendChild(hEdge(20, 15, 50, 20))
      svg.appendChild(hEdge(20, 45, 50, 40))
      svg.appendChild(hEdge(50, 20, 50, 40))
      svg.appendChild(hEdge(50, 20, 85, 15))
      svg.appendChild(hEdge(50, 40, 85, 45))
      svg.appendChild(zNode(50, 20, 9, '\u03B1'))
      svg.appendChild(zNode(50, 40, 9, '-\u03B1'))
      svg.appendChild(zNode(20, 15, 6))
      svg.appendChild(zNode(20, 45, 6))
      svg.appendChild(zNode(85, 15, 6))
      svg.appendChild(zNode(85, 45, 6))
      // =
      svg.appendChild(equalsSign(115, 28))
      // RHS: simplified
      svg.appendChild(hEdge(140, 15, 170, 15))
      svg.appendChild(hEdge(140, 45, 170, 45))
      svg.appendChild(zNode(140, 15, 6))
      svg.appendChild(zNode(140, 45, 6))
      svg.appendChild(zNode(170, 15, 6))
      svg.appendChild(zNode(170, 45, 6))
    },
  },
]

// Pixels per viewBox unit — ensures all spiders render at the same physical size
const VB_SCALE = 1.5

function buildRuleDiagram(spec: RuleSpec): HTMLElement | SVGSVGElement {
  // TikZ SVG: split LHS / RHS
  if (spec.tikzFiles) {
    const container = document.createElement('div')
    container.className = 'learn-rule-diagram learn-tikz-split'
    const pairH = Math.max(spec.tikzFiles.lhsH, spec.tikzFiles.rhsH) * VB_SCALE
    const lhs = document.createElement('img')
    lhs.src = `/learn/${spec.tikzFiles.lhs}`
    lhs.alt = `${spec.name} (left)`
    lhs.style.height = `${pairH}px`
    container.appendChild(lhs)
    const eq = document.createElement('span')
    eq.className = 'learn-tikz-eq'
    eq.textContent = '='
    container.appendChild(eq)
    const rhs = document.createElement('img')
    rhs.src = `/learn/${spec.tikzFiles.rhs}`
    rhs.alt = `${spec.name} (right)`
    rhs.style.height = `${pairH}px`
    container.appendChild(rhs)
    return container
  }
  // Fallback: inline SVG
  const svg = document.createElementNS(NS, 'svg') as SVGSVGElement
  svg.setAttribute('viewBox', '0 0 220 65')
  svg.setAttribute('width', '220')
  svg.setAttribute('height', '65')
  svg.classList.add('learn-rule-diagram')
  spec.buildDiagram(svg)
  return svg
}

/** Populate the learn overlay content area with all 19 rule cards. */
export function buildLearnContent(): void {
  const content = document.querySelector('#learn-overlay .learn-content')
  if (!content) return

  // Clear placeholder
  content.innerHTML = ''

  // Intro
  const intro = document.createElement('p')
  intro.className = 'learn-intro'
  intro.innerHTML = 'The ZX calculus is a graphical language for quantum computing. These rewrite rules preserve the underlying quantum operation (tensor), letting you simplify and reason about diagrams. <a href="https://arxiv.org/abs/2303.03163" target="_blank" rel="noopener">Click here</a> for a digestible paper explaining the important ZX rules in more detail. Try out the exercises in ZX Sketch!'
  content.appendChild(intro)

  const categories: Array<{ key: string; label: string }> = [
    { key: 'basic', label: 'Basic Rules' },
  ]

  for (const cat of categories) {
    const titleEl = document.createElement('div')
    titleEl.className = 'learn-group-title'
    titleEl.textContent = cat.label
    content.appendChild(titleEl)

    for (const rule of RULES.filter(r => r.category === cat.key)) {
      const row = document.createElement('div')
      row.className = 'learn-rule-row'

      // Diagram
      const diagramSvg = buildRuleDiagram(rule)
      row.appendChild(diagramSvg)

      // Info
      const info = document.createElement('div')
      info.className = 'learn-rule-info'

      const name = document.createElement('div')
      name.className = 'learn-rule-name'
      name.textContent = rule.name
      info.appendChild(name)

      const desc = document.createElement('div')
      desc.className = 'learn-rule-desc'
      desc.innerHTML = rule.description
      info.appendChild(desc)

      if (rule.link) {
        const link = document.createElement('a')
        link.className = 'learn-rule-link'
        link.href = rule.link
        link.target = '_blank'
        link.rel = 'noopener'
        link.textContent = 'Learn more \u2192'
        info.appendChild(link)
      }

      row.appendChild(info)
      content.appendChild(row)
    }
  }

  // Footer
  const footer = document.createElement('div')
  footer.className = 'learn-footer'
  footer.innerHTML = 'Rewrites are powered by <a href="https://github.com/Quantomatic/pyzx" target="_blank" rel="noopener">PyZX</a>, and diagrams follow the conventions of the <a href="https://zxcalculus.com" target="_blank" rel="noopener">ZX Calculus</a>.<br>All diagrams on this page rendered with the <a href="https://mirrors.mit.edu/CTAN/graphics/pgf/contrib/zx-calculus/zx-calculus.pdf" target="_blank" rel="noopener">zx-calculus LaTeX package</a>.<br>Find any bugs? Send me an email: Harry.Stoltz [at] nyu.edu'
  content.appendChild(footer)
}
