import type { AppState } from '../AppState.ts'
import { rebuildSpatialIndex } from '../canvas/HitTest.ts'
import { toJSON, fromJSON } from '../model/serialize.ts'
import { proofToJSON } from '../proof/proofSerialize.ts'
import { replaceGraph } from './Autosave.ts'
import { exportTikZ } from '../export/tikz.ts'
import { exportSVG } from '../export/svg.ts'
import { exportPNG } from '../export/png.ts'
import { showToast } from './Toast.ts'

/**
 * Wires up the top toolbar buttons: undo, redo, save, load.
 */
export interface ToolbarCallbacks {
  onGraphChanged?: () => void
  /** Called when undo is clicked in proof mode. Return true if handled. */
  onProofUndo?: () => boolean
  /** Called when a file is opened via the Open button. */
  onFileOpened?: (text: string, filename: string) => void
}

export function setupToolbar(
  app: AppState,
  markDirty: () => void,
  onGraphChanged?: () => void,
  callbacks?: ToolbarCallbacks,
): { updateState: () => void } {
  const btnUndo = document.getElementById('btn-undo') as HTMLButtonElement
  const btnRedo = document.getElementById('btn-redo') as HTMLButtonElement
  const btnSave = document.getElementById('btn-save') as HTMLButtonElement
  const btnOpen = document.getElementById('btn-open') as HTMLButtonElement
  const btnExport = document.getElementById('btn-export') as HTMLButtonElement
  const exportMenu = document.getElementById('export-menu')!

  const saveProofBtn = document.getElementById('save-proof')!

  function updateState() {
    const inProof = app.proof !== null

    // Show/hide proof save option
    saveProofBtn.classList.toggle('hidden', !inProof)

    if (inProof) {
      btnUndo.disabled = !app.proof || app.proof.steps.length === 0
      btnRedo.disabled = true
      btnUndo.title = app.proof && app.proof.steps.length > 0 ? 'Undo proof step' : 'No proof steps to undo'
      btnRedo.title = 'Redo not available in proof mode'
    } else {
      btnUndo.disabled = !app.history.canUndo()
      btnRedo.disabled = !app.history.canRedo()
      const undoLabel = app.history.undoLabel()
      const redoLabel = app.history.redoLabel()
      btnUndo.title = undoLabel ? `Undo: ${undoLabel}` : 'Undo'
      btnRedo.title = redoLabel ? `Redo: ${redoLabel}` : 'Redo'
    }
  }

  btnUndo.addEventListener('click', () => {
    if (app.proof !== null) {
      callbacks?.onProofUndo?.()
      return
    }
    app.history.undo(app.graph)
    app.selectedNodes.clear()
    app.selectedEdges.clear()
    rebuildSpatialIndex(app.graph)
    markDirty()
    updateState()
    onGraphChanged?.()
  })

  btnRedo.addEventListener('click', () => {
    if (app.proof !== null) return
    app.history.redo(app.graph)
    app.selectedNodes.clear()
    app.selectedEdges.clear()
    rebuildSpatialIndex(app.graph)
    markDirty()
    updateState()
    onGraphChanged?.()
  })

  // --- Save/download dropdown ---
  const saveMenu = document.getElementById('save-menu')!

  btnSave.addEventListener('click', () => {
    // Close export menu if open
    exportMenu.classList.add('hidden')
    btnExport.setAttribute('aria-expanded', 'false')
    saveMenu.classList.toggle('hidden')
    btnSave.setAttribute('aria-expanded', String(!saveMenu.classList.contains('hidden')))
  })

  // Dismiss save menu on click outside
  document.addEventListener('pointerdown', (e) => {
    if (!saveMenu.classList.contains('hidden') &&
        !saveMenu.contains(e.target as Node) &&
        e.target !== btnSave && !btnSave.contains(e.target as Node)) {
      saveMenu.classList.add('hidden')
      btnSave.setAttribute('aria-expanded', 'false')
    }
  })

  document.getElementById('save-zxg')!.addEventListener('click', () => {
    // circuitSpace=true divides positions by GRID_SCALE for ZXLive compatibility
    const json = toJSON(app.graph, true)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'diagram.zxg'
    a.click()
    URL.revokeObjectURL(url)
    saveMenu.classList.add('hidden')
  })

  saveProofBtn.addEventListener('click', () => {
    if (!app.proof) return
    const json = proofToJSON(app.proof)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'proof.zxp'
    a.click()
    URL.revokeObjectURL(url)
    saveMenu.classList.add('hidden')
  })

  document.getElementById('save-qasm')!.addEventListener('click', () => {
    saveMenu.classList.add('hidden')
    showToast('Circuit extraction requires the galois library, which is unavailable in browser mode. Export as PyZX JSON and use <code>pyzx.extract_circuit()</code> locally.')
  })

  btnOpen.addEventListener('click', () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.zxg,.zxp,.qasm,.zxproof.json'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const text = reader.result as string
        if (callbacks?.onFileOpened) {
          callbacks.onFileOpened(text, file.name)
        } else {
          // Fallback: treat as graph JSON
          try {
            const graph = fromJSON(text, true)
            replaceGraph(app.graph, graph)
            app.history.clear()
            app.selectedNodes.clear()
            app.selectedEdges.clear()
            rebuildSpatialIndex(app.graph)
            markDirty()
            updateState()
            onGraphChanged?.()
          } catch (err) {
            console.error('Failed to load file:', err)
            alert('Failed to load file. Check the file format.')
          }
        }
      }
      reader.readAsText(file)
    })
    input.click()
  })

  // --- Export dropdown ---
  btnExport.addEventListener('click', () => {
    // Close save menu if open
    saveMenu.classList.add('hidden')
    btnSave.setAttribute('aria-expanded', 'false')
    exportMenu.classList.toggle('hidden')
    btnExport.setAttribute('aria-expanded', String(!exportMenu.classList.contains('hidden')))
  })

  // Dismiss export menu on click outside
  document.addEventListener('pointerdown', (e) => {
    if (!exportMenu.classList.contains('hidden') &&
        !exportMenu.contains(e.target as Node) &&
        e.target !== btnExport && !btnExport.contains(e.target as Node)) {
      exportMenu.classList.add('hidden')
      btnExport.setAttribute('aria-expanded', 'false')
    }
  })

  function downloadText(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  document.getElementById('export-tikz')!.addEventListener('click', () => {
    downloadText(exportTikZ(app.graph), 'diagram.tikz.tex', 'text/plain')
    exportMenu.classList.add('hidden')
  })

  document.getElementById('export-svg')!.addEventListener('click', () => {
    downloadText(exportSVG(app.graph), 'diagram.svg', 'image/svg+xml')
    exportMenu.classList.add('hidden')
  })

  document.getElementById('export-png')!.addEventListener('click', () => {
    exportPNG(app.graph)
    exportMenu.classList.add('hidden')
  })

  updateState()
  return { updateState }
}
