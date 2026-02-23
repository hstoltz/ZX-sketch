import type { CameraState } from '../canvas/Camera.ts'
import { worldToScreen } from '../canvas/Camera.ts'
import type { AppState } from '../AppState.ts'
import { NodeType, EdgeType } from '../model/types.ts'
import { setNodeType, setPhase, removeNode, removeEdge } from '../model/Graph.ts'
import { parsePhase, phaseToString, phaseToJsonString } from '../model/Phase.ts'
import { rebuildSpatialIndex } from '../canvas/HitTest.ts'

export interface ContextMenuCallbacks {
  /** Called when color is changed with "Apply as rewrite" on. Routes through PyZX. */
  onRewriteColorChange?: (nodeId: string) => void
  /** Called when the user clicks Unfuse — enters unfuse partition mode. */
  onUnfuseSpider?: (nodeId: string) => void
}

/**
 * Manages the right-click context menu for spiders and edges.
 */
export function setupContextMenu(
  app: AppState,
  camera: CameraState,
  markDirty: () => void,
  onGraphChanged: () => void,
  menuCallbacks?: ContextMenuCallbacks,
): { dismiss: () => void; showForNode: (id: string) => void; showForEdge: (id: string) => void } {
  const menu = document.getElementById('context-menu')!
  const rewriteRow = document.getElementById('ctx-rewrite-row')!
  const rewriteToggle = document.getElementById('ctx-rewrite-toggle') as HTMLInputElement
  const rewriteLabel = rewriteRow.querySelector('.ctx-rewrite-label') as HTMLElement
  const colorRow = document.getElementById('ctx-color-row')!
  const btnColorZ = document.getElementById('ctx-color-z') as HTMLButtonElement
  const btnColorX = document.getElementById('ctx-color-x') as HTMLButtonElement
  const phaseRow = document.getElementById('ctx-phase-row')!
  const phaseInput = document.getElementById('ctx-phase-input') as HTMLInputElement
  const phasePresets = document.getElementById('ctx-phase-presets')!
  const edgeTypeRow = document.getElementById('ctx-edge-type-row')!
  const btnToggleHadamard = document.getElementById('ctx-toggle-hadamard') as HTMLButtonElement
  const btnDelete = document.getElementById('ctx-delete') as HTMLButtonElement
  const sepEl = menu.querySelector('.ctx-sep') as HTMLElement
  const splitRow = document.getElementById('ctx-split-row')!
  const splitBtn = document.getElementById('ctx-split-btn') as HTMLButtonElement

  let targetNodeId: string | null = null
  let targetEdgeId: string | null = null

  // Rewrite mode: ON by default outside proof mode (checked = apply as rewrite)
  let rewriteMode = true

  function dismiss() {
    menu.classList.add('hidden')
    targetNodeId = null
    targetEdgeId = null
  }

  function showForNode(nodeId: string) {
    const node = app.graph.nodes.get(nodeId)
    if (!node) return

    targetNodeId = nodeId
    targetEdgeId = null

    const inProof = app.proof !== null
    const isSpider = node.type !== NodeType.Boundary

    // In proof mode: force rewrite ON (color change always goes through PyZX)
    if (inProof) {
      rewriteMode = true
      rewriteToggle.checked = true
    }

    // Show rewrite toggle for spiders only
    rewriteRow.style.display = isSpider ? 'flex' : 'none'
    rewriteToggle.checked = inProof ? true : rewriteMode
    rewriteToggle.disabled = inProof
    rewriteLabel.classList.toggle('disabled', inProof)

    // Show node-specific controls, hide edge controls
    colorRow.style.display = isSpider ? 'flex' : 'none'
    phaseRow.style.display = isSpider && !inProof ? 'flex' : 'none'
    phasePresets.style.display = isSpider && !inProof ? 'flex' : 'none'
    edgeTypeRow.style.display = 'none'
    btnDelete.style.display = inProof ? 'none' : 'block'
    sepEl.style.display = inProof ? 'none' : 'block'

    // Set active color button
    btnColorZ.classList.toggle('active', node.type === NodeType.Z)
    btnColorX.classList.toggle('active', node.type === NodeType.X)

    // Set phase input value
    const phaseStr = phaseToString(node.phase)
    phaseInput.value = phaseStr || '0'

    // Set active preset
    const jsonPhase = phaseToJsonString(node.phase)
    for (const btn of phasePresets.querySelectorAll('.ctx-preset')) {
      const el = btn as HTMLElement
      el.classList.toggle('active', el.dataset.phase === jsonPhase)
    }

    // Unfuse row: show for spiders (not boundary)
    splitRow.style.display = isSpider ? 'block' : 'none'

    positionMenu(node.x, node.y)
  }

  function showForEdge(edgeId: string) {
    const edge = app.graph.edges.get(edgeId)
    if (!edge) return

    targetEdgeId = edgeId
    targetNodeId = null

    // Hide node-specific controls, show edge controls
    rewriteRow.style.display = 'none'
    colorRow.style.display = 'none'
    phaseRow.style.display = 'none'
    phasePresets.style.display = 'none'
    splitRow.style.display = 'none'
    edgeTypeRow.style.display = 'block'
    btnDelete.style.display = 'block'
    sepEl.style.display = 'block'

    // Update button text
    btnToggleHadamard.textContent = edge.type === EdgeType.Hadamard
      ? 'Set to Simple'
      : 'Set to Hadamard'

    // Position at edge midpoint
    const source = app.graph.nodes.get(edge.source)
    const target = app.graph.nodes.get(edge.target)
    if (source && target) {
      const mx = (source.x + target.x) / 2
      const my = (source.y + target.y) / 2
      positionMenu(mx, my)
    }
  }

  function positionMenu(worldX: number, worldY: number) {
    const screen = worldToScreen(camera, worldX, worldY)
    // Offset slightly so menu doesn't cover the node
    let left = screen.x + 20
    let top = screen.y - 20

    // Clamp to viewport
    menu.classList.remove('hidden')
    const rect = menu.getBoundingClientRect()
    if (left + rect.width > window.innerWidth - 10) {
      left = screen.x - rect.width - 20
    }
    if (top + rect.height > window.innerHeight - 10) {
      top = window.innerHeight - rect.height - 10
    }
    if (top < 10) top = 10

    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }

  // --- Rewrite toggle ---
  rewriteToggle.addEventListener('change', () => {
    rewriteMode = rewriteToggle.checked
  })

  // --- Color toggle ---
  function applyColorChange(newType: NodeType) {
    if (!targetNodeId) return
    const node = app.graph.nodes.get(targetNodeId)
    if (!node || node.type === newType) return

    const isCosmetic = !rewriteMode

    if (isCosmetic) {
      // Cosmetic: just flip the color, no edge changes
      if (app.proof === null) {
        app.history.save(app.graph, newType === NodeType.Z ? 'Change to Z' : 'Change to X')
      }
      setNodeType(app.graph, targetNodeId, newType)
      markDirty()
      onGraphChanged()
      showForNode(targetNodeId)
    } else {
      // Non-cosmetic: route through PyZX as a real color_change rewrite
      const nodeId = targetNodeId
      menuCallbacks?.onRewriteColorChange?.(nodeId)
      dismiss()
    }
  }

  btnColorZ.addEventListener('click', () => applyColorChange(NodeType.Z))
  btnColorX.addEventListener('click', () => applyColorChange(NodeType.X))

  // --- Phase presets ---
  for (const btn of phasePresets.querySelectorAll('.ctx-preset')) {
    btn.addEventListener('click', () => {
      if (!targetNodeId) return
      const phaseStr = (btn as HTMLElement).dataset.phase!
      try {
        const p = parsePhase(phaseStr)
        app.history.save(app.graph, 'Set phase')
        setPhase(app.graph, targetNodeId, p)
        markDirty()
        onGraphChanged()
        showForNode(targetNodeId)
      } catch {
        // ignore invalid preset (shouldn't happen)
      }
    })
  }

  // --- Phase text input ---
  phaseInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (!targetNodeId) return
      const val = phaseInput.value.trim()
      try {
        const p = parsePhase(val || '0')
        app.history.save(app.graph, 'Set phase')
        setPhase(app.graph, targetNodeId, p)
        markDirty()
        onGraphChanged()
        showForNode(targetNodeId)
      } catch {
        phaseInput.style.borderColor = 'rgba(196, 43, 43, 0.5)'
        setTimeout(() => { phaseInput.style.borderColor = '' }, 800)
      }
    }
    if (e.key === 'Escape') {
      dismiss()
    }
    // Prevent canvas keyboard shortcuts from firing while typing
    e.stopPropagation()
  })

  // --- Unfuse (split) ---
  splitBtn.addEventListener('click', () => {
    if (!targetNodeId) return
    const nodeId = targetNodeId
    dismiss()
    menuCallbacks?.onUnfuseSpider?.(nodeId)
  })

  // --- Toggle Hadamard ---
  btnToggleHadamard.addEventListener('click', () => {
    if (!targetEdgeId) return
    const edge = app.graph.edges.get(targetEdgeId)
    if (!edge) return
    app.history.save(app.graph, 'Toggle edge type')
    // Mutate the edge type (edges have readonly type, so replace)
    const newType = edge.type === EdgeType.Hadamard ? EdgeType.Simple : EdgeType.Hadamard
    app.graph.edges.set(targetEdgeId, { ...edge, type: newType })
    markDirty()
    onGraphChanged()
    showForEdge(targetEdgeId)
  })

  // --- Delete ---
  btnDelete.addEventListener('click', () => {
    if (targetNodeId) {
      const node = app.graph.nodes.get(targetNodeId)
      if (node) {
        app.animations.animateNodeOut({
          id: node.id, x: node.x, y: node.y,
          type: node.type, phaseLabel: phaseToString(node.phase),
          anim: null!,
        })
      }
      app.history.save(app.graph, 'Delete')
      removeNode(app.graph, targetNodeId)
      app.selectedNodes.delete(targetNodeId)
      rebuildSpatialIndex(app.graph)
    } else if (targetEdgeId) {
      app.history.save(app.graph, 'Delete edge')
      removeEdge(app.graph, targetEdgeId)
      app.selectedEdges.delete(targetEdgeId)
    }
    markDirty()
    onGraphChanged()
    dismiss()
  })

  // --- Dismiss on click outside ---
  document.addEventListener('pointerdown', (e) => {
    if (!menu.classList.contains('hidden') && !menu.contains(e.target as Node)) {
      dismiss()
    }
  })

  // --- Dismiss on Escape ---
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dismiss()
  })

  return { dismiss, showForNode, showForEdge }
}
