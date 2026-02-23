import { NodeType, EdgeType } from '../model/types.ts'

/** The active tool determines what double-click and drag-from-wire-zone create. */
export type ActiveTool = 'z' | 'x' | 'boundary' | 'hadamard'

export interface PaletteState {
  activeTool: ActiveTool
  /** Get the NodeType for the active placement tool, or null if not a node tool. */
  nodeType(): NodeType | null
  /** Whether the active tool creates Hadamard edges (for wire creation). */
  edgeType(): EdgeType
  /** Switch to tool by index: 1=Z, 2=X, 3=Boundary, 4=Hadamard. */
  setTool(index: number): void
  /** Toggle proof mode appearance on the palette. */
  setProofMode(mode: boolean | 'setup'): void
}

/**
 * Wires up the left palette buttons. Tracks which tool is active.
 */
export function setupPalette(callbacks?: { onModeToggle?: () => void }): PaletteState {
  const buttons: Record<ActiveTool, HTMLButtonElement> = {
    z: document.getElementById('tool-z') as HTMLButtonElement,
    x: document.getElementById('tool-x') as HTMLButtonElement,
    boundary: document.getElementById('tool-boundary') as HTMLButtonElement,
    hadamard: document.getElementById('tool-hadamard') as HTMLButtonElement,
  }

  const toolOrder: ActiveTool[] = ['z', 'x', 'boundary', 'hadamard']

  const paletteEl = document.getElementById('palette')!
  const modeToggleEl = document.getElementById('mode-toggle')!
  const segPlay = modeToggleEl.querySelector('[data-mode="play"]') as HTMLButtonElement
  const segProof = modeToggleEl.querySelector('[data-mode="proof"]') as HTMLButtonElement
  const proofTimeline = document.getElementById('proof-timeline')!

  const state: PaletteState = {
    activeTool: 'z',
    nodeType() {
      switch (state.activeTool) {
        case 'z': return NodeType.Z
        case 'x': return NodeType.X
        case 'boundary': return NodeType.Boundary
        case 'hadamard': return null
      }
    },
    edgeType() {
      return state.activeTool === 'hadamard' ? EdgeType.Hadamard : EdgeType.Simple
    },
    setTool(index: number) {
      const tool = toolOrder[index - 1]
      if (tool) setActive(tool)
    },
    setProofMode(mode: boolean | 'setup') {
      if (mode === false) {
        // Play mode
        paletteEl.classList.remove('proof-mode', 'proof-setup')
        segPlay.classList.add('active')
        segProof.classList.remove('active')
        segPlay.setAttribute('aria-checked', 'true')
        segProof.setAttribute('aria-checked', 'false')
        proofTimeline.classList.add('hidden')
      } else if (mode === 'setup') {
        // Setup phase: tools visible, timeline visible, Proof segment active
        paletteEl.classList.remove('proof-mode')
        paletteEl.classList.add('proof-setup')
        segPlay.classList.remove('active')
        segProof.classList.add('active')
        segPlay.setAttribute('aria-checked', 'false')
        segProof.setAttribute('aria-checked', 'true')
        proofTimeline.classList.remove('hidden')
      } else {
        // Active proof
        paletteEl.classList.add('proof-mode')
        paletteEl.classList.remove('proof-setup')
        segPlay.classList.remove('active')
        segProof.classList.add('active')
        segPlay.setAttribute('aria-checked', 'false')
        segProof.setAttribute('aria-checked', 'true')
        proofTimeline.classList.remove('hidden')
      }
    },
  }

  function setActive(tool: ActiveTool) {
    state.activeTool = tool
    for (const [key, btn] of Object.entries(buttons)) {
      const isActive = key === tool
      btn.classList.toggle('active', isActive)
      btn.setAttribute('aria-pressed', String(isActive))
    }
  }

  for (const [key, btn] of Object.entries(buttons)) {
    btn.addEventListener('click', () => setActive(key as ActiveTool))
  }

  segPlay.addEventListener('click', () => {
    if (!segPlay.classList.contains('active')) callbacks?.onModeToggle?.()
  })
  segProof.addEventListener('click', () => {
    if (!segProof.classList.contains('active')) callbacks?.onModeToggle?.()
  })

  return state
}
