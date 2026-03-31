import './style.css'
import { createCamera, centerOnBounds } from './canvas/Camera.ts'
import { createRenderer } from './canvas/Renderer.ts'
import { setupInput } from './canvas/InputHandler.ts'
import { createAppState } from './AppState.ts'
import type { GraphData } from './model/types.ts'
import { EdgeType } from './model/types.ts'
import { cloneGraph } from './model/Graph.ts'
import { rebuildSpatialIndex } from './canvas/HitTest.ts'
import { setupToolbar } from './ui/Toolbar.ts'
import { setupPalette } from './ui/Palette.ts'
import { setupContextMenu } from './ui/ContextMenu.ts'
import { setupAutosave, restoreAutosave, replaceGraph } from './ui/Autosave.ts'
import { animateRewriteTransition } from './rewrite/animateRewrite.ts'
import { pyzx } from './pyodide/PyZXService.ts'
import { toJSON, toJSONWithMap, fromJSON } from './model/serialize.ts'
import { showToast } from './ui/Toast.ts'
import { reconcileGraph } from './model/reconcile.ts'
import { setupRewritePanel } from './ui/RewritePanel.ts'
import { createProof, addStep, removeLastStep, currentGraph, setGoal } from './proof/ProofModel.ts'
import { setupProofPanel } from './ui/ProofPanel.ts'
import { proofToJSON, proofFromJSON } from './proof/proofSerialize.ts'
import { createFocusTrap } from './ui/FocusTrap.ts'
import { launchConfetti } from './canvas/Confetti.ts'
import { buildLearnContent } from './ui/LearnOverlay.ts'
import { buildSettingsContent } from './ui/SettingsOverlay.ts'
import { exportSVG } from './export/svg.ts'
import * as themeManager from './theme/ThemeManager.ts'

function getContext(id: string): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.getElementById(id) as HTMLCanvasElement
  const ctx = canvas.getContext('2d')!
  if (!ctx) throw new Error(`Failed to get 2D context for #${id}`)
  return { canvas, ctx }
}

function initCanvases() {
  const scene = getContext('scene-canvas')
  const interaction = getContext('interaction-canvas')

  function resize() {
    const dpr = window.devicePixelRatio || 1
    const width = window.innerWidth
    const height = window.innerHeight

    for (const c of [scene.canvas, interaction.canvas]) {
      c.width = width * dpr
      c.height = height * dpr
      c.style.width = `${width}px`
      c.style.height = `${height}px`
    }
  }

  resize()
  window.addEventListener('resize', () => {
    resize()
    renderer.markDirty()
  })

  return { scene, interaction }
}

// --- Boot ---
themeManager.init()
const { scene, interaction } = initCanvases()
const camera = createCamera()
const app = createAppState()

// --- Shared diagram via URL hash ---
async function loadFromUrlHash(): Promise<boolean> {
  const hash = window.location.hash
  if (!hash.startsWith('#diagram=')) return false
  try {
    const encoded = hash.slice('#diagram='.length)
    const compressed = Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
    const ds = new DecompressionStream('gzip')
    const writer = ds.writable.getWriter()
    writer.write(compressed)
    writer.close()
    const reader = ds.readable.getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    let decompressed: Uint8Array
    if (chunks.length === 1) {
      decompressed = chunks[0]
    } else {
      const total = chunks.reduce((n, c) => n + c.length, 0)
      decompressed = new Uint8Array(total)
      let off = 0
      for (const c of chunks) { decompressed.set(c, off); off += c.length }
    }
    const jsonStr = new TextDecoder().decode(decompressed)
    const graph = fromJSON(jsonStr)
    replaceGraph(app.graph, graph)
    rebuildSpatialIndex(app.graph)
    // Clear hash so refreshing doesn't fight with autosave
    history.replaceState(null, '', window.location.pathname + window.location.search)
    return true
  } catch (err) {
    console.error('Failed to load diagram from URL:', err)
    return false
  }
}

// --- Try to restore: URL hash > autosave > demo data ---
loadFromUrlHash().then(loaded => {
  if (loaded) {
    // Re-center camera on the loaded graph
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const node of app.graph.nodes.values()) {
      if (node.x < minX) minX = node.x
      if (node.y < minY) minY = node.y
      if (node.x > maxX) maxX = node.x
      if (node.y > maxY) maxY = node.y
    }
    if (isFinite(minX)) {
      centerOnBounds(camera, minX, minY, maxX, maxY, window.innerWidth, window.innerHeight)
    }
    renderer.markDirty()
    showToast('Loaded shared diagram')
  }
})

const restored = restoreAutosave(app)

if (!restored) {
  // --- Demo data: 4-qubit circuit ---
  const demoGraph = fromJSON(JSON.stringify({
    initial_graph: {
      version: 2, backend: 'multigraph', variable_types: {},
      inputs: [0,1,2,3], outputs: [20,21,22,23],
      vertices: [
        {id:0,t:0,pos:[1,0]},{id:1,t:0,pos:[1,1]},{id:2,t:0,pos:[1,2]},{id:3,t:0,pos:[1,3]},
        {id:4,t:1,pos:[2,0]},{id:5,t:2,pos:[2,1]},{id:6,t:1,pos:[2,2]},{id:7,t:1,pos:[2,3]},
        {id:8,t:1,pos:[3,0]},{id:9,t:1,pos:[3,1]},{id:10,t:2,pos:[3,2]},{id:11,t:1,pos:[3,3]},
        {id:12,t:1,pos:[4,0]},{id:13,t:2,pos:[4,1]},{id:14,t:1,pos:[4,2]},{id:15,t:1,pos:[4,3]},
        {id:16,t:2,pos:[5,0]},{id:17,t:2,pos:[5,1]},{id:18,t:1,pos:[5,2]},{id:19,t:2,pos:[5,3]},
        {id:20,t:0,pos:[6,0]},{id:21,t:0,pos:[6,1]},{id:22,t:0,pos:[6,2]},{id:23,t:0,pos:[6,3]},
      ],
      edges: [
        [0,4,1],[1,5,1],[2,6,1],[3,7,1],[4,5,1],[4,8,1],[5,9,1],[5,10,1],
        [6,10,1],[7,11,1],[8,12,1],[9,13,2],[10,14,1],[11,15,1],[12,16,1],
        [12,17,1],[13,17,2],[13,18,2],[14,17,1],[14,18,1],[15,18,1],[15,19,1],
        [16,20,1],[17,21,1],[18,22,1],[19,23,1],
      ],
    },
  }))
  replaceGraph(app.graph, demoGraph)
  rebuildSpatialIndex(app.graph)
}

// Center camera on the loaded graph
{
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const node of app.graph.nodes.values()) {
    if (node.x < minX) minX = node.x
    if (node.y < minY) minY = node.y
    if (node.x > maxX) maxX = node.x
    if (node.y > maxY) maxY = node.y
  }
  if (isFinite(minX)) {
    centerOnBounds(camera, minX, minY, maxX, maxY, window.innerWidth, window.innerHeight)
  }
}

// --- UI Chrome ---
const palette = setupPalette({
  onModeToggle: () => {
    if (app.proof) {
      // Active proof → Play (confirm if steps exist)
      if (app.proof.steps.length > 0) {
        const keep = confirm('Exit proof mode?\n\nOK = keep current diagram\nCancel = stay in proof mode')
        if (!keep) return
      }
      exitProofMode()
      showToast('Proof mode ended')
    } else if (app.proofSetup) {
      // Setup → Play — if editing goal, restore initial first
      if (editingGoal && savedInitialGraph) {
        loadGraphSnapshot(savedInitialGraph)
        savedInitialGraph = null
        editingGoal = false
      }
      exitProofMode()
    } else {
      // Play → Setup
      enterProofSetup()
    }
  },
})

// --- Renderer ---
let inputTick: (dt: number) => void = () => {}

const renderer = createRenderer(
  scene.canvas, scene.ctx,
  camera, app,
  (dt) => inputTick(dt),
)

// --- Theme → re-render ---
import { clearGlossCache } from './canvas/elements.ts'
themeManager.subscribe(() => { clearGlossCache(); renderer.markDirty() })

// --- Autosave ---
const autosave = setupAutosave(app)

// Graph change callback: updates toolbar state + triggers autosave + notifies rewrite panel
function onGraphChanged() {
  toolbar.updateState()
  autosave.scheduleAutosave()
  rewritePanel.onGraphChanged()
  if (app.proof) scheduleProofAutosave()
}

// --- Load graph snapshot (used by proof panel navigation) ---
function loadGraphSnapshot(graph: GraphData) {
  replaceGraph(app.graph, graph)
  app.selectedNodes.clear()
  app.selectedEdges.clear()
  rebuildSpatialIndex(app.graph)
  renderer.markDirty()
}

// ─── PyZX rewrite helpers ───

/** Apply a single-node rewrite (e.g. color_change) via PyZX. */
async function applyRewriteViaCallback(nodeId: string, ruleId: string, ruleName: string) {
  try {
    const { json, nanoidToInt } = toJSONWithMap(app.graph, true)
    const intId = nanoidToInt.get(nodeId)
    if (intId === undefined) return

    const resultJson = await pyzx.applyRewrite(json, ruleId, [intId])
    const { newGraph, diff } = reconcileGraph(app.graph, resultJson, nanoidToInt)

    if (diff.removedNodeIds.size === 0 && diff.addedNodes.size === 0 &&
        diff.removedEdgeIds.size === 0 && diff.addedEdges.size === 0) {
      showToast(`<span class="toast-muted">${ruleName}:</span> no changes`)
      return
    }

    if (app.proof !== null) {
      // Proof mode: record step (no undo history)
    } else {
      app.history.save(app.graph, ruleName)
    }
    animateRewriteTransition(app, diff, newGraph)
    verifyTensorIfEnabled(json, ruleName)
    renderer.markDirty()
    onGraphChanged()

    if (app.proof !== null) {
      addStep(app.proof, app.graph, ruleName, ruleId)
      app.proofViewingPast = false
      proofPanel.refresh()
      scheduleProofAutosave()
      checkGoalReached()
    }
  } catch (err) {
    console.error(`[main] applyRewrite("${ruleId}") failed:`, err)
    showToast(`<span style="color:#c42b2b">${ruleName} failed</span>`)
  }
}

/** Apply Hopf rule via one-click cut on an edge. Takes the two vertex nanoid IDs from the match. */
async function applyHopfCut(v1: string, v2: string) {
  try {
    const { json, nanoidToInt } = toJSONWithMap(app.graph, true)
    const int1 = nanoidToInt.get(v1)
    const int2 = nanoidToInt.get(v2)
    if (int1 === undefined || int2 === undefined) return

    const beforeJson = json
    const resultJson = await pyzx.applyRewrite(json, 'hopf', [int1, int2])
    const { newGraph, diff } = reconcileGraph(app.graph, resultJson, nanoidToInt)

    if (diff.removedNodeIds.size === 0 && diff.addedNodes.size === 0 &&
        diff.removedEdgeIds.size === 0 && diff.addedEdges.size === 0) {
      showToast('<span class="toast-muted">Hopf:</span> no changes')
      return
    }

    if (app.proof !== null) {
      // Proof mode: record step (no undo history)
    } else {
      app.history.save(app.graph, 'Hopf')
    }
    animateRewriteTransition(app, diff, newGraph)
    verifyTensorIfEnabled(beforeJson, 'Hopf')
    renderer.markDirty()
    onGraphChanged()

    if (app.proof !== null) {
      addStep(app.proof, app.graph, 'Hopf', 'hopf')
      app.proofViewingPast = false
      proofPanel.refresh()
      scheduleProofAutosave()
      checkGoalReached()
    }
  } catch (err) {
    console.error('[main] Hopf cut failed:', err)
    showToast('<span style="color:#c42b2b">Hopf failed</span>')
  }
}

/** Apply a rewrite with pre-computed int IDs (e.g. edge-based rules like wire_vertex). */
async function applyEdgeRewrite(json: string, nanoidToInt: Map<string, number>, intIds: number[], ruleId: string, ruleName: string) {
  try {
    const resultJson = await pyzx.applyRewrite(json, ruleId, intIds)
    const { newGraph, diff } = reconcileGraph(app.graph, resultJson, nanoidToInt)

    if (diff.removedNodeIds.size === 0 && diff.addedNodes.size === 0 &&
        diff.removedEdgeIds.size === 0 && diff.addedEdges.size === 0) {
      showToast(`<span class="toast-muted">${ruleName}:</span> no changes`)
      return
    }

    if (app.proof !== null) {
      // Proof mode: record step (no undo history)
    } else {
      app.history.save(app.graph, ruleName)
    }
    animateRewriteTransition(app, diff, newGraph)
    verifyTensorIfEnabled(json, ruleName)
    renderer.markDirty()
    onGraphChanged()

    if (app.proof !== null) {
      addStep(app.proof, app.graph, ruleName, ruleId)
      app.proofViewingPast = false
      proofPanel.refresh()
      scheduleProofAutosave()
      checkGoalReached()
    }
  } catch (err) {
    console.error(`[main] applyEdgeRewrite("${ruleId}") failed:`, err)
    showToast(`<span style="color:#c42b2b">${ruleName} failed</span>`)
  }
}

/** Apply spider fusion via PyZX in proof mode. */
async function applyFusionViaCallback(targetId: string, draggedId: string) {
  try {
    const { json, nanoidToInt } = toJSONWithMap(app.graph, true)
    const intTarget = nanoidToInt.get(targetId)
    const intDragged = nanoidToInt.get(draggedId)
    if (intTarget === undefined || intDragged === undefined) return

    const resultJson = await pyzx.applyRewrite(json, 'spider_fusion', [intTarget, intDragged])
    const { newGraph } = reconcileGraph(app.graph, resultJson, nanoidToInt)

    replaceGraph(app.graph, newGraph)
    rebuildSpatialIndex(app.graph)
    verifyTensorIfEnabled(json, 'Spider Fusion')
    renderer.markDirty()
    onGraphChanged()

    if (app.proof !== null) {
      addStep(app.proof, app.graph, 'Spider Fusion', 'spider_fusion')
      app.proofViewingPast = false
      proofPanel.refresh()
      scheduleProofAutosave()
      checkGoalReached()
    }
  } catch (err) {
    console.error('[main] fusion via PyZX failed:', err)
    showToast('<span style="color:#c42b2b">Fusion failed</span>')
  }
}


// --- Toolbar (needs markDirty) ---
const toolbar = setupToolbar(app, renderer.markDirty, () => autosave.scheduleAutosave(), {
  onProofUndo: () => {
    if (!app.proof || app.proof.steps.length === 0) return false
    app.proof.goalReached = false
    removeLastStep(app.proof)
    const graph = cloneGraph(currentGraph(app.proof))
    loadGraphSnapshot(graph)
    app.proofViewingPast = false
    onGraphChanged()
    proofPanel.refresh()
    scheduleProofAutosave()
    showToast('Proof step undone')
    return true
  },
  onFileOpened: (text, filename) => {
    if (filename.endsWith('.zxproof.json')) {
      loadProofFromText(text)
    } else if (filename.endsWith('.zxp')) {
      // .zxp may be proof or graph-only
      try {
        const parsed = JSON.parse(text)
        if ('proof_steps' in parsed || 'initialGraph' in parsed) {
          loadProofFromText(text)
        } else {
          loadGraphFromText(text)
        }
      } catch {
        loadGraphFromText(text)
      }
    } else if (filename.endsWith('.qasm')) {
      loadQASMFromText(text, filename)
    } else {
      loadGraphFromText(text)
    }
  },
})

// --- Rewrite Panel ---
const rewritePanel = setupRewritePanel(app, pyzx, renderer.markDirty, onGraphChanged, {
  onRewriteApplied: (newGraph, ruleName, ruleId) => {
    if (!app.proof) return
    addStep(app.proof, newGraph, ruleName, ruleId)
    app.proofViewingPast = false
    proofPanel.refresh()
    scheduleProofAutosave()
    checkGoalReached()
  },
  onVerifyTensor: (beforeJson, ruleName) => {
    verifyTensorIfEnabled(beforeJson, ruleName)
  },
  onEngineReady: () => {
    if (app.proofSetup && !app.proof) {
      proofPanel.refreshSetup(pendingGoal !== null)
    }
  },
})

// --- Context Menu ---
const contextMenu = setupContextMenu(app, camera, renderer.markDirty, onGraphChanged, {
  onRewriteColorChange: (nodeId) => {
    applyRewriteViaCallback(nodeId, 'color_change', 'Color Change')
  },
  onUnfuseSpider: (nodeId) => {
    rewritePanel.enterUnfuseForNode(nodeId)
  },
})

// --- Proof Panel ---
const proofPanel = setupProofPanel(app, renderer.markDirty, onGraphChanged, loadGraphSnapshot, {
  onSwitchToGoal: () => switchToGoalEditing(),
  onSwitchToInitial: () => switchToInitialEditing(),
  onGoalPreviewClick: () => showGoalOverlay(),
  isEngineReady: () => pyzx.isReady(),
})

// --- Keyboard Shortcuts Overlay ---
const shortcutsOverlay = document.getElementById('shortcuts-overlay')!
const btnShortcuts = document.getElementById('btn-shortcuts') as HTMLButtonElement
const shortcutsTrap = createFocusTrap(shortcutsOverlay.querySelector('.shortcuts-panel')!)

function showShortcuts() {
  shortcutsOverlay.classList.remove('hidden')
  shortcutsTrap.activate()
}

function hideShortcuts() {
  shortcutsOverlay.classList.add('hidden')
  shortcutsTrap.deactivate()
}

function toggleShortcuts() {
  if (shortcutsOverlay.classList.contains('hidden')) {
    showShortcuts()
  } else {
    hideShortcuts()
  }
}

btnShortcuts.addEventListener('click', toggleShortcuts)
document.getElementById('shortcuts-close')!.addEventListener('click', hideShortcuts)
shortcutsOverlay.addEventListener('pointerdown', (e) => {
  if (e.target === shortcutsOverlay) hideShortcuts()
})
shortcutsOverlay.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideShortcuts()
})

// --- Learn More Overlay ---
const learnOverlay = document.getElementById('learn-overlay')!
const btnLearn = document.getElementById('btn-learn') as HTMLButtonElement
const learnTrap = createFocusTrap(learnOverlay.querySelector('.learn-panel')!)

function showLearn() {
  learnOverlay.classList.remove('hidden')
  learnTrap.activate()
}

function hideLearn() {
  learnOverlay.classList.add('hidden')
  learnTrap.deactivate()
}

buildLearnContent()
btnLearn.addEventListener('click', showLearn)
learnOverlay.querySelector('.learn-close')!.addEventListener('click', hideLearn)
learnOverlay.addEventListener('pointerdown', (e) => {
  if (e.target === learnOverlay) hideLearn()
})
learnOverlay.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideLearn()
})

// --- Settings Overlay ---
const settingsOverlay = document.getElementById('settings-overlay')!
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement
const settingsTrap = createFocusTrap(settingsOverlay.querySelector('.settings-panel')!)

function showSettings() {
  settingsOverlay.classList.remove('hidden')
  settingsTrap.activate()
}

function hideSettings() {
  settingsOverlay.classList.add('hidden')
  settingsTrap.deactivate()
}

buildSettingsContent()
btnSettings.addEventListener('click', showSettings)
settingsOverlay.querySelector('.settings-close')!.addEventListener('click', hideSettings)
settingsOverlay.addEventListener('pointerdown', (e) => {
  if (e.target === settingsOverlay) hideSettings()
})
settingsOverlay.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideSettings()
})

// Rebuild learn diagrams when theme changes (they use theme colors)
themeManager.subscribe(() => buildLearnContent())

// --- Input Handler ---
const input = setupInput(
  interaction.canvas,
  camera,
  app,
  renderer.markDirty,
  {
    getPlacementNodeType: () => palette.nodeType(),
    getPlacementEdgeType: () => palette.edgeType(),
    showContextMenuForNode: (id) => contextMenu.showForNode(id),
    showContextMenuForEdge: (id) => contextMenu.showForEdge(id),
    dismissContextMenu: () => contextMenu.dismiss(),
    onGraphChanged,
    onSelectionChanged: () => rewritePanel.onSelectionChanged(),
    onProofFusion: (targetId, draggedId) => {
      applyFusionViaCallback(targetId, draggedId)
    },
    isEditingLocked: () => app.proof !== null,
    onProofUndo: () => {
      if (!app.proof || app.proof.steps.length === 0) return false
      app.proof.goalReached = false
      removeLastStep(app.proof)
      const graph = cloneGraph(currentGraph(app.proof))
      loadGraphSnapshot(graph)
      app.proofViewingPast = false
      onGraphChanged()
      proofPanel.refresh()
      showToast('Proof step undone')
      return true
    },
    onProofRedo: () => app.proof !== null, // consume event, no redo in v1
    setPaletteTool: (index) => palette.setTool(index),
    toggleShortcutsOverlay: () => toggleShortcuts(),
    onColorChangeRewrite: (nodeId) => {
      applyRewriteViaCallback(nodeId, 'color_change', 'Color Change')
    },
    getActiveTool: () => palette.activeTool,
    onIdRemoval: (nodeId) => {
      applyRewriteViaCallback(nodeId, 'id_removal', 'Identity Removal')
    },
    getIdRemovalNodes: () => app.idRemovalNodes,
    onHopfCut: (v1, v2) => {
      applyHopfCut(v1, v2)
    },
    getHopfCutEdges: () => app.hopfCutEdges,
    isUnfusePartitionActive: () => app.unfusePartition !== null,
    onUnfuseEdgeToggle: (edgeId) => rewritePanel.toggleUnfuseEdge(edgeId),
    onUnfuseCancel: () => rewritePanel.cancelUnfusePartition(),
    onWireVertex: (edgeId, clickWorld) => {
      const edge = app.graph.edges.get(edgeId)
      if (!edge) return
      const srcNode = app.graph.nodes.get(edge.source)
      const tgtNode = app.graph.nodes.get(edge.target)
      if (!srcNode || !tgtNode) return
      const { json, nanoidToInt } = toJSONWithMap(app.graph, true)
      const intSrc = nanoidToInt.get(edge.source)
      const intTgt = nanoidToInt.get(edge.target)
      if (intSrc === undefined || intTgt === undefined) return

      // PyZX wire_vertex puts the original edge type (e.g. Hadamard) on the
      // first→mid sub-edge, and Simple on mid→second. Order endpoints so the
      // Hadamard stays on the far side from the click and the new vertex
      // appears on the side the user clicked.
      const dSrc = (clickWorld.x - srcNode.x) ** 2 + (clickWorld.y - srcNode.y) ** 2
      const dTgt = (clickWorld.x - tgtNode.x) ** 2 + (clickWorld.y - tgtNode.y) ** 2
      const ids = dSrc > dTgt ? [intSrc, intTgt] : [intTgt, intSrc]

      applyEdgeRewrite(json, nanoidToInt, ids, 'wire_vertex', 'Add Wire Vertex')
    },
  },
)
inputTick = input.tick

// --- Proof mode enter/exit (three-state: Play → Setup → Active Proof) ---
let pendingGoal: GraphData | null = null

function enterProofSetup() {
  app.proofSetup = true
  editingGoal = false
  // app.proof stays null → editing unlocked
  palette.setProofMode('setup')
  proofPanel.showSetup(pendingGoal !== null)
  showGoalBox()
  showToast('Build your diagram, then Start Proof')
  toolbar.updateState()
  rewritePanel.onGraphChanged()
}

function startProof() {
  // If currently editing goal, auto-save it first
  if (editingGoal && savedInitialGraph) {
    const currentGoalGraph = cloneGraph(app.graph)
    if (currentGoalGraph.nodes.size > 0) {
      pendingGoal = currentGoalGraph
    }
    loadGraphSnapshot(savedInitialGraph)
    savedInitialGraph = null
    editingGoal = false
  }

  app.proof = createProof(app.graph)
  if (pendingGoal) {
    setGoal(app.proof, pendingGoal)
    pendingGoal = null
  }
  app.proofSetup = false
  app.proofViewingPast = false
  app.history.clear()
  hideGoalBox()
  palette.setProofMode(true)
  proofPanel.show()
  showToast('Proof started')
  toolbar.updateState()
  rewritePanel.onGraphChanged()
  scheduleProofAutosave()
  if (app.proof.goalGraph) checkGoalReached()
}

function exitProofMode() {
  app.proof = null
  app.proofSetup = false
  app.proofViewingPast = false
  editingGoal = false
  savedInitialGraph = null
  pendingGoal = null
  hideGoalBox()
  hideGoalOverlay()
  proofPanel.hide()
  palette.setProofMode(false)
  toolbar.updateState()
  rewritePanel.onGraphChanged()
  clearProofAutosave()
}

// Listen for exit event from proof panel
window.addEventListener('proof-exit', () => {
  if (app.proofSetup && !app.proof) {
    // Exit from setup phase — if editing goal, restore initial first
    if (editingGoal && savedInitialGraph) {
      loadGraphSnapshot(savedInitialGraph)
      savedInitialGraph = null
      editingGoal = false
    }
    exitProofMode()
    return
  }
  if (!app.proof) return
  if (app.proof.steps.length > 0) {
    const keep = confirm('Exit proof mode?\n\nOK = keep current diagram\nCancel = stay in proof mode')
    if (!keep) return
  }
  exitProofMode()
  showToast('Proof mode ended')
})

// Listen for restart event from proof panel
window.addEventListener('proof-restart', () => {
  if (!app.proof) return
  // Preserve goal if one was set
  const goalGraph = app.proof.goalGraph ? app.proof.goalGraph : null
  // Restore initial diagram
  loadGraphSnapshot(app.proof.initialGraph)
  // Exit proof mode fully
  exitProofMode()
  // Re-enter setup with goal preserved
  if (goalGraph) pendingGoal = goalGraph
  enterProofSetup()
  showToast('Proof restarted')
})

// Listen for start event from proof setup panel
window.addEventListener('proof-start', () => {
  if (app.proofSetup && !app.proof) {
    startProof()
  }
})

// --- Goal editing (tab-switching approach) ---
let savedInitialGraph: GraphData | null = null
let editingGoal = false

function switchToGoalEditing() {
  if (!app.proofSetup || app.proof) return

  // Auto-save current initial diagram
  savedInitialGraph = cloneGraph(app.graph)

  // Load existing goal, or clone initial as starting point for goal
  if (pendingGoal) {
    loadGraphSnapshot(cloneGraph(pendingGoal))
  } else {
    loadGraphSnapshot(cloneGraph(savedInitialGraph))
  }

  editingGoal = true
  app.history.clear()
  app.selectedNodes.clear()
  app.selectedEdges.clear()

  // Update sidebar tabs
  proofPanel.setSetupMode('goal')

  // Mark goal box as active (selected)
  goalPreviewBox.classList.add('active')

  toolbar.updateState()
  rewritePanel.onGraphChanged()
  renderer.markDirty()
}

function switchToInitialEditing() {
  if (!app.proofSetup || app.proof || !editingGoal) return

  // Auto-save current goal diagram
  const currentGoalGraph = cloneGraph(app.graph)
  // Only save as goal if there's actually something drawn
  if (currentGoalGraph.nodes.size > 0) {
    pendingGoal = currentGoalGraph
  }

  // Restore initial diagram
  if (savedInitialGraph) {
    loadGraphSnapshot(savedInitialGraph)
    savedInitialGraph = null
  }

  editingGoal = false
  app.history.clear()
  app.selectedNodes.clear()
  app.selectedEdges.clear()

  // Update sidebar tabs
  proofPanel.setSetupMode('initial')
  proofPanel.refreshSetup(pendingGoal !== null)

  // Deselect goal box, update its preview
  goalPreviewBox.classList.remove('active')
  updateGoalBox()

  toolbar.updateState()
  rewritePanel.onGraphChanged()
  renderer.markDirty()
}

// --- Goal Preview Box (floating on canvas) ---
const goalPreviewBox = document.getElementById('goal-preview-box')!
const goalBoxLabel = goalPreviewBox.querySelector('.goal-box-label') as HTMLElement
const goalBoxSvg = goalPreviewBox.querySelector('.goal-box-svg') as HTMLElement

goalPreviewBox.addEventListener('click', () => {
  if (!editingGoal) switchToGoalEditing()
})

goalPreviewBox.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && !editingGoal) {
    e.preventDefault()
    switchToGoalEditing()
  }
})

function showGoalBox() {
  goalPreviewBox.classList.remove('hidden')
  updateGoalBox()
}

function hideGoalBox() {
  goalPreviewBox.classList.add('hidden')
  goalPreviewBox.classList.remove('active')
}

function updateGoalBox() {
  if (pendingGoal && pendingGoal.nodes.size > 0) {
    goalPreviewBox.classList.add('has-preview')
    goalPreviewBox.title = 'Goal diagram'
    goalBoxLabel.textContent = ''
    goalBoxSvg.innerHTML = exportSVG(pendingGoal, true)
  } else {
    goalPreviewBox.classList.remove('has-preview')
    goalPreviewBox.title = ''
    goalBoxLabel.textContent = 'Goal Diagram'
    goalBoxSvg.innerHTML = ''
  }
}

// --- Goal Overlay (modal for viewing goal during active proof) ---
const goalOverlay = document.getElementById('goal-overlay')!
const goalOverlaySvg = goalOverlay.querySelector('.goal-overlay-svg') as HTMLElement
const goalOverlayTrap = createFocusTrap(goalOverlay.querySelector('.goal-overlay-panel')!)

function showGoalOverlay() {
  const goalGraph = app.proof?.goalGraph
  if (!goalGraph) return

  goalOverlaySvg.innerHTML = exportSVG(goalGraph)
  goalOverlay.classList.remove('hidden')
  goalOverlayTrap.activate()
}

function hideGoalOverlay() {
  goalOverlay.classList.add('hidden')
  goalOverlayTrap.deactivate()
}

goalOverlay.querySelector('.goal-overlay-close')!.addEventListener('click', hideGoalOverlay)
goalOverlay.addEventListener('pointerdown', (e) => {
  if (e.target === goalOverlay) hideGoalOverlay()
})
goalOverlay.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideGoalOverlay()
})

// --- Tensor verification toggle ---
// Checkbox is in Settings overlay (built by buildSettingsContent above)
const verifyCb = document.getElementById('rw-verify-cb') as HTMLInputElement

async function verifyTensorIfEnabled(beforeJson: string, ruleName: string) {
  if (!verifyCb?.checked) return
  const qubits = Math.max(app.graph.inputs.length, app.graph.outputs.length)
  if (qubits > 12) {
    showToast('<span class="toast-muted">Tensor verify skipped (too many qubits)</span>')
    return
  }
  try {
    const { json: afterJson } = toJSONWithMap(app.graph, true)
    const equal = await pyzx.compareTensors(beforeJson, afterJson)
    if (equal) {
      showToast(`<span class="toast-highlight">\u2713 Tensor verified</span> (${ruleName})`)
    } else {
      showToast(`<span style="color:#c42b2b">\u26A0 Tensor mismatch after ${ruleName}!</span>`)
    }
  } catch (err) {
    console.warn('[verify] Tensor comparison failed:', err)
  }
}

// --- Goal comparison ---
let goalCheckInProgress = false

/**
 * Build a structural fingerprint of a graph: sorted list of (type, phase, degree) per node,
 * plus sorted edge-type counts. Two graphs must have identical fingerprints to be structurally equal.
 */
function graphFingerprint(g: GraphData): string {
  // Per-node: (type, phase_n, phase_d, degree)
  const nodeSigs: string[] = []
  for (const node of g.nodes.values()) {
    const degree = g.incidentEdges.get(node.id)?.size ?? 0
    nodeSigs.push(`${node.type}:${node.phase.n}/${node.phase.d}:${degree}`)
  }
  nodeSigs.sort()

  // Per-edge: count by type and self-loop status
  let simpleEdges = 0, hadamardEdges = 0, simpleSelfLoops = 0, hadamardSelfLoops = 0
  for (const edge of g.edges.values()) {
    const isSelf = edge.source === edge.target
    if (edge.type === EdgeType.Hadamard) {
      if (isSelf) hadamardSelfLoops++; else hadamardEdges++
    } else {
      if (isSelf) simpleSelfLoops++; else simpleEdges++
    }
  }

  return `${nodeSigs.join(',')}|${simpleEdges},${hadamardEdges},${simpleSelfLoops},${hadamardSelfLoops}|i${g.inputs.length}o${g.outputs.length}`
}

async function checkGoalReached() {
  if (!app.proof || !app.proof.goalGraph || app.proof.goalReached || goalCheckInProgress) return

  const proof = app.proof
  const goalGraph = proof.goalGraph!

  // Structural fingerprint must match (type, phase, degree per node + edge types)
  if (graphFingerprint(app.graph) !== graphFingerprint(goalGraph)) return

  // Skip tensor comparison for large diagrams (O(2^n))
  const qubits = Math.max(app.graph.inputs.length, app.graph.outputs.length)
  if (qubits > 12) return

  goalCheckInProgress = true
  try {
    const { json: currentJson } = toJSONWithMap(app.graph, true)
    const { json: goalJson } = toJSONWithMap(goalGraph, true)
    const equal = await pyzx.compareTensors(currentJson, goalJson)

    if (equal && app.proof === proof && !proof.goalReached) {
      proof.goalReached = true
      proofPanel.refresh()
      scheduleProofAutosave()
      showToast('<span class="toast-highlight">Goal reached!</span>')
      launchConfetti(scene.canvas)
    }
  } catch (err) {
    console.warn('[main] Goal comparison failed:', err)
  } finally {
    goalCheckInProgress = false
  }
}

// --- Proof autosave ---
const PROOF_STORAGE_KEY = 'zx-sketch-proof-autosave'
let proofAutosaveTimer: ReturnType<typeof setTimeout> | null = null

function scheduleProofAutosave() {
  if (proofAutosaveTimer !== null) clearTimeout(proofAutosaveTimer)
  proofAutosaveTimer = setTimeout(() => {
    if (!app.proof) return
    try {
      localStorage.setItem(PROOF_STORAGE_KEY, proofToJSON(app.proof))
    } catch { /* ignore */ }
  }, 2000)
}

function clearProofAutosave() {
  if (proofAutosaveTimer !== null) clearTimeout(proofAutosaveTimer)
  localStorage.removeItem(PROOF_STORAGE_KEY)
}

// Restore proof on boot, or default to proof setup mode
let restoredProof = false
try {
  const proofJson = localStorage.getItem(PROOF_STORAGE_KEY)
  if (proofJson) {
    const proof = proofFromJSON(proofJson)
    app.proof = proof
    app.proofViewingPast = false
    // Load the current step's graph
    const graph = cloneGraph(currentGraph(proof))
    loadGraphSnapshot(graph)
    proofPanel.show()
    palette.setProofMode(true)
    toolbar.updateState()
    restoredProof = true
  }
} catch {
  localStorage.removeItem(PROOF_STORAGE_KEY)
}

// Default to proof setup mode if no active proof was restored
if (!restoredProof) {
  enterProofSetup()
}

// --- QASM import ---
async function loadQASMFromText(qasmText: string, filename?: string) {
  try {
    if (app.proof) exitProofMode()
    showToast('Converting QASM circuit\u2026')
    const graphJson = await pyzx.fromQASM(qasmText)

    // PyZX returns circuit-space positions (small integers); scale to world coords
    const graph = fromJSON(graphJson, true)
    app.history.clear()
    replaceGraph(app.graph, graph)
    app.selectedNodes.clear()
    app.selectedEdges.clear()
    rebuildSpatialIndex(app.graph)
    renderer.markDirty()
    onGraphChanged()

    const qubits = graph.inputs.length
    const nodes = graph.nodes.size
    const edges = graph.edges.size
    const label = filename || 'QASM circuit'
    showToast(`Imported ${label} — ${qubits} qubit${qubits !== 1 ? 's' : ''}, ${nodes} nodes, ${edges} edges`)
  } catch (err) {
    console.error('QASM import failed:', err)
    showToast(`<span style="color:#c42b2b">QASM import failed:</span> ${err instanceof Error ? err.message : String(err)}`)
  }
}

// --- Drag-and-drop file loading ---
function loadGraphFromText(text: string) {
  try {
    if (app.proof) exitProofMode()
    // External graph files use circuit-space positions (small integers);
    // scale up to world coordinates. fromJSON already handles initial_graph
    // wrapper; scalePositions=true covers plain .zxg/.json files too.
    const graph = fromJSON(text, true)
    app.history.clear()
    replaceGraph(app.graph, graph)
    app.selectedNodes.clear()
    app.selectedEdges.clear()
    rebuildSpatialIndex(app.graph)
    renderer.markDirty()
    onGraphChanged()
  } catch (err) {
    console.error('Failed to load diagram:', err)
    alert('Failed to load diagram. Check the file format.')
  }
}

function loadProofFromText(text: string) {
  try {
    const proof = proofFromJSON(text)
    app.proof = proof
    app.proofViewingPast = false
    const graph = cloneGraph(currentGraph(proof))
    loadGraphSnapshot(graph)
    proofPanel.show()
    palette.setProofMode(true)
    toolbar.updateState()
    showToast('Proof loaded')
  } catch (err) {
    console.error('Failed to load proof:', err)
    alert('Failed to load proof. Check the file format.')
  }
}

document.addEventListener('dragover', (e) => {
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'copy'
})

document.addEventListener('drop', (e) => {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (!file) return
  if (file.name.endsWith('.zxproof.json') || file.name.endsWith('.zxp')) {
    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      // .zxp files may be proofs (with proof_steps) or plain graphs (initial_graph only)
      try {
        const parsed = JSON.parse(text)
        if ('proof_steps' in parsed || 'initialGraph' in parsed) {
          loadProofFromText(text)
        } else if ('initial_graph' in parsed) {
          // ZXLive graph-only .zxp (no proof steps)
          loadGraphFromText(text)
        } else {
          loadGraphFromText(text)
        }
      } catch {
        loadGraphFromText(text)
      }
    }
    reader.readAsText(file)
    return
  }
  if (file.name.endsWith('.qasm')) {
    const reader = new FileReader()
    reader.onload = () => loadQASMFromText(reader.result as string, file.name)
    reader.readAsText(file)
    return
  }
  if (!file.name.endsWith('.json') && !file.name.endsWith('.zxg')) return
  const reader = new FileReader()
  reader.onload = () => loadGraphFromText(reader.result as string)
  reader.readAsText(file)
})

// --- Offline indicator ---
const offlineBadge = document.getElementById('offline-badge')!

function updateOfflineStatus() {
  offlineBadge.classList.toggle('hidden', navigator.onLine)
}

updateOfflineStatus()
window.addEventListener('online', updateOfflineStatus)
window.addEventListener('offline', updateOfflineStatus)

// --- Share button ---
const btnShare = document.getElementById('btn-share') as HTMLButtonElement

btnShare.addEventListener('click', async () => {
  try {
    const json = toJSON(app.graph)
    // Compress with gzip
    const cs = new CompressionStream('gzip')
    const writer = cs.writable.getWriter()
    writer.write(new TextEncoder().encode(json))
    writer.close()
    const reader = cs.readable.getReader()
    const chunks: Uint8Array[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const compressed = new Uint8Array(
      chunks.reduce((n, c) => n + c.length, 0)
    )
    let offset = 0
    for (const c of chunks) {
      compressed.set(c, offset)
      offset += c.length
    }
    const encoded = btoa(String.fromCharCode(...compressed))
    const url = `${window.location.origin}${window.location.pathname}#diagram=${encoded}`

    if (url.length > 8000) {
      showToast('Diagram too large for URL sharing — use Save to export as a file')
      return
    }

    await navigator.clipboard.writeText(url)
    showToast('Link copied to clipboard!')
  } catch (err) {
    console.error('Share failed:', err)
    showToast('<span style="color:#c42b2b">Failed to copy link</span>')
  }
})

renderer.start()
