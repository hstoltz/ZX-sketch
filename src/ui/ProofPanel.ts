import type { AppState } from '../AppState.ts'
import type { Proof } from '../proof/ProofModel.ts'
import { currentGraph, goToStep, isAtLatest } from '../proof/ProofModel.ts'
import { cloneGraph } from '../model/Graph.ts'
import { proofToJSON } from '../proof/proofSerialize.ts'
import { exportProofLaTeX } from '../export/proofTikz.ts'
import { showToast } from './Toast.ts'
import { exportSVG } from '../export/svg.ts'
import type { GraphData } from '../model/types.ts'

export interface ProofPanel {
  show(): void
  hide(): void
  refresh(): void
  onStepChanged(): void
  showSetup(hasGoal: boolean): void
  refreshSetup(hasGoal: boolean): void
  setSetupMode(mode: 'initial' | 'goal'): void
  showGoalPreviewInSidebar(goalGraph: GraphData | null): void
}

export interface ProofPanelCallbacks {
  onSwitchToGoal?: () => void
  onSwitchToInitial?: () => void
  onGoalPreviewClick?: () => void
  isEngineReady?: () => boolean
}

export function setupProofPanel(
  app: AppState,
  markDirty: () => void,
  onGraphChanged: () => void,
  loadGraphSnapshot: (graph: import('../model/types.ts').GraphData) => void,
  callbacks?: ProofPanelCallbacks,
): ProofPanel {
  const panelEl = document.getElementById('proof-timeline')!
  panelEl.innerHTML = `
    <div class="proof-body">
      <div class="proof-sidebar-goal-container"></div>
      <div class="proof-header">
        <span>Proof</span>
        <button class="proof-restart-btn" title="Restart proof">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2.5 2.5v3.5h3.5"/>
            <path d="M2.5 6C3 4 4.8 2.2 7.2 2.2A4.8 4.8 0 1 1 2.7 8.5"/>
          </svg>
        </button>
      </div>
      <div class="proof-steps"></div>
      <div class="proof-actions">
        <button class="proof-save-btn">Save Proof</button>
        <button class="proof-export-btn">Export LaTeX</button>
      </div>
    </div>
  `
  const bodyEl = panelEl.querySelector('.proof-body') as HTMLElement
  const goalContainer = panelEl.querySelector('.proof-sidebar-goal-container') as HTMLElement
  const stepsContainer = panelEl.querySelector('.proof-steps') as HTMLElement
  const saveBtn = panelEl.querySelector('.proof-save-btn') as HTMLButtonElement
  const exportBtn = panelEl.querySelector('.proof-export-btn') as HTMLButtonElement
  const restartBtn = panelEl.querySelector('.proof-restart-btn') as HTMLButtonElement

  restartBtn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('proof-restart'))
  })

  saveBtn.addEventListener('click', () => {
    if (!app.proof) return
    const json = proofToJSON(app.proof)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'proof.zxp'
    a.click()
    URL.revokeObjectURL(url)
    showToast('Proof saved')
  })

  exportBtn.addEventListener('click', () => {
    if (!app.proof) return
    const tex = exportProofLaTeX(app.proof)
    const blob = new Blob([tex], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'proof.tex'
    a.click()
    URL.revokeObjectURL(url)
    showToast('LaTeX exported')
  })

  function buildTimeline() {
    stepsContainer.innerHTML = ''
    const proof = app.proof
    if (!proof) return

    // Initial step
    const initialEl = createStepItem(-1, 'Start Diagram', null, proof)
    stepsContainer.appendChild(initialEl)

    // Rewrite steps
    for (let i = 0; i < proof.steps.length; i++) {
      const step = proof.steps[i]
      const display = step.label ?? step.ruleName
      const stepEl = createStepItem(i, `${i + 1}. ${display}`, step.ruleName, proof)
      stepsContainer.appendChild(stepEl)
    }

    // Goal reached indicator (only when viewing latest step)
    if (proof.goalGraph && proof.goalReached && isAtLatest(proof)) {
      const reachedEl = document.createElement('div')
      reachedEl.className = 'proof-goal-item'
      reachedEl.style.marginTop = '6px'
      const dot = document.createElement('span')
      dot.className = 'proof-goal-dot reached'
      const label = document.createElement('span')
      label.className = 'proof-goal-label reached'
      label.textContent = 'Goal reached!'
      reachedEl.appendChild(dot)
      reachedEl.appendChild(label)
      stepsContainer.appendChild(reachedEl)
    }
  }

  function createStepItem(index: number, text: string, subtitle: string | null, proof: Proof): HTMLElement {
    const el = document.createElement('button')
    el.className = 'proof-step'
    if (proof.currentStep === index) {
      el.classList.add('active')
    }

    const dot = document.createElement('span')
    dot.className = 'proof-dot'
    if (proof.currentStep === index) {
      dot.classList.add('filled')
    }

    const labelEl = document.createElement('span')
    labelEl.className = 'proof-step-label'
    labelEl.textContent = text

    el.appendChild(dot)
    el.appendChild(labelEl)

    if (subtitle && index >= 0 && proof.steps[index].label) {
      const sub = document.createElement('span')
      sub.className = 'proof-step-subtitle'
      sub.textContent = subtitle
      el.appendChild(sub)
    }

    el.addEventListener('click', () => {
      navigateToStep(index)
    })

    // Double-click to edit label (only on rewrite steps, not initial)
    if (index >= 0) {
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation()
        editStepLabel(index)
      })
    }

    return el
  }

  function navigateToStep(index: number) {
    const proof = app.proof
    if (!proof) return

    goToStep(proof, index)
    const graph = cloneGraph(currentGraph(proof))
    loadGraphSnapshot(graph)

    app.proofViewingPast = !isAtLatest(proof)
    markDirty()
    onGraphChanged()
    buildTimeline()
    // Refresh goal preview (gold border depends on isAtLatest)
    if (proof.goalGraph) {
      showGoalPreviewInSidebar(proof.goalGraph)
    }
  }

  function editStepLabel(index: number) {
    const proof = app.proof
    if (!proof || index < 0 || index >= proof.steps.length) return

    const step = proof.steps[index]
    const current = step.label ?? ''
    const newLabel = prompt('Step annotation:', current)
    if (newLabel === null) return // cancelled
    step.label = newLabel || null
    buildTimeline()
  }

  // --- Setup phase UI ---
  let setupEl: HTMLElement | null = null
  const setupTitleEl = document.getElementById('proof-setup-title')!

  function showSetup(hasGoal: boolean) {
    bodyEl.style.display = 'none'
    if (setupEl) setupEl.remove()

    setupTitleEl.classList.remove('hidden')

    setupEl = document.createElement('div')
    setupEl.className = 'proof-setup-body'
    buildSetupContent(setupEl, hasGoal, 'initial')
    panelEl.appendChild(setupEl)
    panelEl.classList.remove('hidden')
  }

  function refreshSetup(hasGoal: boolean) {
    if (!setupEl) return
    const currentMode = setupEl.dataset.mode as 'initial' | 'goal' || 'initial'
    buildSetupContent(setupEl, hasGoal, currentMode)
  }

  function setSetupMode(mode: 'initial' | 'goal') {
    if (!setupEl) return
    const hasGoal = setupEl.dataset.hasGoal === 'true'
    buildSetupContent(setupEl, hasGoal, mode)
  }

  function buildSetupContent(container: HTMLElement, hasGoal: boolean, mode: 'initial' | 'goal') {
    container.innerHTML = ''
    container.dataset.mode = mode
    container.dataset.hasGoal = String(hasGoal)

    // Subtitle
    const subtitle = document.createElement('div')
    subtitle.className = 'proof-setup-subtitle'
    subtitle.textContent = mode === 'goal'
      ? 'Editing goal diagram.'
      : 'Edit your diagram, then start.'
    container.appendChild(subtitle)

    // "Start Diagram" tab — highlighted when editing initial, clickable when editing goal
    const initialTab = document.createElement('button')
    initialTab.className = 'proof-setup-tab'
    if (mode === 'initial') initialTab.classList.add('active')
    const initialDot = document.createElement('span')
    initialDot.className = 'tab-dot'
    initialTab.appendChild(initialDot)
    initialTab.appendChild(document.createTextNode('Start Diagram'))
    if (mode === 'goal') {
      initialTab.addEventListener('click', () => {
        callbacks?.onSwitchToInitial?.()
      })
    }
    container.appendChild(initialTab)

    // Start Proof button
    const startBtn = document.createElement('button')
    startBtn.className = 'proof-start-btn'
    const engineReady = callbacks?.isEngineReady?.() ?? false
    if (!engineReady) {
      startBtn.textContent = 'Loading engine\u2026'
      startBtn.disabled = true
    } else {
      startBtn.textContent = '\u25b6 Start Proof'
    }
    startBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('proof-start'))
    })
    container.appendChild(startBtn)
  }

  // --- Goal preview in sidebar (active proof) ---
  function showGoalPreviewInSidebar(goalGraph: GraphData | null) {
    goalContainer.innerHTML = ''
    if (!goalGraph) return

    const previewEl = document.createElement('div')
    previewEl.className = 'proof-sidebar-goal-preview'

    previewEl.title = 'Goal diagram'

    const svgStr = exportSVG(goalGraph, true)
    previewEl.insertAdjacentHTML('beforeend', svgStr)

    // Update reached state (only when viewing latest step)
    if (app.proof?.goalReached && isAtLatest(app.proof)) {
      previewEl.classList.add('goal-reached')
    }

    previewEl.addEventListener('click', () => {
      callbacks?.onGoalPreviewClick?.()
    })

    goalContainer.appendChild(previewEl)
  }

  function hideSetup() {
    if (setupEl) {
      setupEl.remove()
      setupEl = null
    }
    setupTitleEl.classList.add('hidden')
    bodyEl.style.display = ''
  }

  function show() {
    hideSetup()
    panelEl.classList.remove('hidden')
    buildTimeline()
    // Show goal preview if proof has a goal
    if (app.proof?.goalGraph) {
      showGoalPreviewInSidebar(app.proof.goalGraph)
    }
  }

  function hide() {
    hideSetup()
    goalContainer.innerHTML = ''
    panelEl.classList.add('hidden')
  }

  function refresh() {
    buildTimeline()
    // Refresh goal preview state (e.g. reached)
    if (app.proof?.goalGraph) {
      showGoalPreviewInSidebar(app.proof.goalGraph)
    }
  }

  function onStepChanged() {
    buildTimeline()
  }

  return { show, hide, refresh, onStepChanged, showSetup, refreshSetup, setSetupMode, showGoalPreviewInSidebar }
}
