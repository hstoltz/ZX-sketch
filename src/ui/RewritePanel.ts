import { RULE_CATALOG, BPW2020_CATALOG, type RewriteRule } from '../rewrite/rules.ts'
import type { AppState } from '../AppState.ts'
import type { PyZXService } from '../pyodide/PyZXService.ts'
import { toJSONWithMap } from '../model/serialize.ts'
import { reconcileGraph } from '../model/reconcile.ts'
import { showToast } from './Toast.ts'
import { animateRewriteTransition } from '../rewrite/animateRewrite.ts'
import { phaseToString, parsePhase, addPhases, negatePhase } from '../model/Phase.ts'
import type { Phase } from '../model/types.ts'

const DEBOUNCE_MS = 200

interface FilteredMatch {
  /** Nanoid node IDs (for highlighting on canvas). */
  nanoids: string[]
  /** Original PyZX int vertex IDs (for sending back to applyRewrite). */
  intIds: number[]
}

interface RuleButtonState {
  rule: RewriteRule
  btn: HTMLButtonElement
  countEl: HTMLElement
  prevBtn: HTMLButtonElement
  nextBtn: HTMLButtonElement
  /** All raw matches from PyZX (int vertex IDs). */
  matches: number[][]
  /** Matches filtered by selection, with both nanoid and int representations. */
  filteredMatches: FilteredMatch[]
  /** Index of the currently highlighted match (for cycling). */
  currentIndex: number
}

export interface RewritePanel {
  onSelectionChanged(): void
  onGraphChanged(): void
  /** Toggle an edge between Original/New sides during unfuse partition. */
  toggleUnfuseEdge(edgeId: string): void
  /** Cancel unfuse partition mode. */
  cancelUnfusePartition(): void
  /** Enter unfuse partition mode for a specific node (used by context menu). */
  enterUnfuseForNode(nodeId: string): void
}

export interface RewritePanelCallbacks {
  onRewriteApplied?: (newGraph: import('../model/types.ts').GraphData, ruleName: string, ruleId: string) => void
  onVerifyTensor?: (beforeJson: string, ruleName: string) => void
  onEngineReady?: () => void
}

export function setupRewritePanel(
  app: AppState,
  pyzx: PyZXService,
  markDirty: () => void,
  onGraphChanged: () => void,
  panelCallbacks?: RewritePanelCallbacks,
): RewritePanel {
  const panelEl = document.getElementById('rewrite-panel')!
  const toggleBtn = document.getElementById('rw-toggle')!
  const statusEl = document.getElementById('rw-status')!
  const statsEl = document.getElementById('rw-stats')!
  statsEl.textContent = '\u2014 nodes \u00b7 \u2014 edges'

  // --- Stabilizer mode state ---
  const STABILIZER_KEY = 'zx-sketch-stabilizer-axioms'
  let stabilizerMode = localStorage.getItem(STABILIZER_KEY) === '1'

  // --- Build rule buttons ---
  const ruleStates: RuleButtonState[] = []
  const stabilizerRuleStates: RuleButtonState[] = []

  function addRuleButton(rule: RewriteRule, targetList: RuleButtonState[]) {
    const group = panelEl.querySelector(`.rw-group[data-category="${rule.category}"]`)
    if (!group) return

    const btn = document.createElement('button')
    btn.className = 'rw-rule-btn'
    btn.disabled = true
    btn.title = rule.description
    if (rule.category === 'graph_like') btn.dataset.expandOnly = '1'

    const label = document.createElement('span')
    label.className = 'rw-rule-label'
    label.textContent = rule.name

    const nav = document.createElement('span')
    nav.className = 'rw-rule-nav'

    const prevBtn = document.createElement('button')
    prevBtn.className = 'rw-nav-btn'
    prevBtn.textContent = '\u2039'
    prevBtn.tabIndex = -1

    const count = document.createElement('span')
    count.className = 'rw-rule-count'

    const nextBtn = document.createElement('button')
    nextBtn.className = 'rw-nav-btn'
    nextBtn.textContent = '\u203a'
    nextBtn.tabIndex = -1

    nav.appendChild(prevBtn)
    nav.appendChild(count)
    nav.appendChild(nextBtn)

    btn.appendChild(label)
    btn.appendChild(nav)
    group.appendChild(btn)

    const ruleState: RuleButtonState = {
      rule,
      btn,
      countEl: count,
      prevBtn,
      nextBtn,
      matches: [],
      filteredMatches: [],
      currentIndex: 0,
    }
    targetList.push(ruleState)

    // Hover: highlight current match on canvas
    btn.addEventListener('mouseenter', () => {
      highlightCurrentMatch(ruleState)
    })

    btn.addEventListener('mouseleave', () => {
      app.rewriteHighlightNodes.clear()
      app.rewriteHighlightEdges.clear()
      markDirty()
    })

    // Click: apply the current match (or enter partition mode for unfuse)
    btn.addEventListener('click', () => {
      if (ruleState.filteredMatches.length === 0) return
      if (ruleState.rule.pyzxName === 'unfuse') {
        enterUnfusePartition(ruleState)
        return
      }
      applyRewrite(ruleState)
    })

    // Nav arrows: cycle through matches without applying
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      cycleMatch(ruleState, -1)
    })

    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      cycleMatch(ruleState, 1)
    })
  }

  // Build buttons for both catalogs
  for (const rule of RULE_CATALOG) addRuleButton(rule, ruleStates)
  for (const rule of BPW2020_CATALOG) addRuleButton(rule, stabilizerRuleStates)

  /** Returns the active rule states based on current mode. */
  function activeRuleStates() {
    return stabilizerMode ? stabilizerRuleStates : ruleStates
  }

  // --- Mode switching ---
  function applyModeVisibility() {
    const basicGroup = panelEl.querySelector('.rw-group[data-category="basic"]') as HTMLElement | null
    const graphLikeGroup = panelEl.querySelector('.rw-group[data-category="graph_like"]') as HTMLElement | null
    const stabGroup = panelEl.querySelector('.rw-group[data-category="stabilizer"]') as HTMLElement | null
    const simpGroupEl = panelEl.querySelector('.rw-group[data-category="simplify"]') as HTMLElement | null

    if (stabilizerMode) {
      if (basicGroup) basicGroup.style.display = 'none'
      if (graphLikeGroup) graphLikeGroup.style.display = 'none'
      if (stabGroup) stabGroup.style.display = ''
      if (simpGroupEl) simpGroupEl.style.display = 'none'
    } else {
      if (basicGroup) basicGroup.style.display = ''
      if (graphLikeGroup) graphLikeGroup.style.display = ''
      if (stabGroup) stabGroup.style.display = 'none'
      if (simpGroupEl) simpGroupEl.style.display = ''
    }
  }
  applyModeVisibility()

  // --- Match cycling helpers ---

  function highlightCurrentMatch(rs: RuleButtonState) {
    app.rewriteHighlightNodes.clear()
    app.rewriteHighlightEdges.clear()
    if (rs.filteredMatches.length === 0) return
    const match = rs.filteredMatches[rs.currentIndex]
    for (const nodeId of match.nanoids) {
      app.rewriteHighlightNodes.add(nodeId)
    }
    // For edge-based rules, also highlight the edge between the match endpoints
    if (rs.rule.pyzxName === 'wire_vertex' && match.nanoids.length === 2) {
      const [nA, nB] = match.nanoids
      for (const [edgeId, edge] of app.graph.edges) {
        if ((edge.source === nA && edge.target === nB) ||
            (edge.source === nB && edge.target === nA)) {
          app.rewriteHighlightEdges.add(edgeId)
          break
        }
      }
    }
    markDirty()
  }

  function cycleMatch(rs: RuleButtonState, delta: number) {
    if (rs.filteredMatches.length <= 1) return
    rs.currentIndex = (rs.currentIndex + delta + rs.filteredMatches.length) % rs.filteredMatches.length
    updateCountDisplay(rs)
    highlightCurrentMatch(rs)
  }

  function updateCountDisplay(rs: RuleButtonState) {
    const total = rs.filteredMatches.length
    if (total <= 1) {
      rs.countEl.textContent = total === 1 ? '1' : ''
      rs.prevBtn.style.display = 'none'
      rs.nextBtn.style.display = 'none'
    } else {
      rs.countEl.textContent = `${rs.currentIndex + 1}/${total}`
      rs.prevBtn.style.display = 'inline-flex'
      rs.nextBtn.style.display = 'inline-flex'
    }
  }

  // --- Simplify strategy buttons ---
  const STRATEGIES = [
    // Compact view (shown when panel is collapsed)
    { id: 'full_reduce', name: 'Full Reduce', primary: true, compact: true },
    { id: 'clifford_simp', name: 'Clifford Simplify', primary: false, compact: true },
    { id: 'basic_simp', name: 'Basic Simplify', primary: false, compact: true },
    { id: 'to_graph_like', name: 'To Graph-Like', primary: false, compact: true },
    { id: 'spider_simp', name: 'Spider Simplify', primary: false, compact: true },
    // Expanded only
    { id: 'bialg_simp', name: 'Bialgebra Simplify', primary: false, compact: false },
    { id: 'phase_free_simp', name: 'Phase Free', primary: false, compact: false },
    { id: 'lcomp_simp', name: 'Local Comp. Simplify', primary: false, compact: false },
    { id: 'pivot_simp', name: 'Pivot Simplify', primary: false, compact: false },
    { id: 'pivot_boundary_simp', name: 'Pivot Boundary', primary: false, compact: false },
    { id: 'pivot_gadget_simp', name: 'Pivot Gadget', primary: false, compact: false },
    { id: 'gadget_simp', name: 'Gadget Simplify', primary: false, compact: false },
    { id: 'supplementarity_simp', name: 'Supplementarity', primary: false, compact: false },
    { id: 'to_gh', name: 'To Green-Hadamard', primary: false, compact: false },
    { id: 'to_rg', name: 'To Red-Green Form', primary: false, compact: false },
    { id: 'to_clifford_normal_form', name: 'Clifford Normal Form', primary: false, compact: false },
    { id: 'teleport_reduce', name: 'Teleport Reduce', primary: false, compact: false },
    { id: 'interior_clifford_simp', name: 'Interior Clifford', primary: false, compact: false },
  ]

  const simpGroup = panelEl.querySelector('.rw-group[data-category="simplify"]')
  let simplifyInProgress = false

  if (simpGroup) {
    for (const strat of STRATEGIES) {
      const btn = document.createElement('button')
      btn.className = 'rw-simp-btn' + (strat.primary ? ' primary' : '')
      btn.title = strat.name
      if (!strat.compact) btn.dataset.expandOnly = '1'

      const label = document.createElement('span')
      label.textContent = strat.name

      btn.appendChild(label)
      simpGroup.appendChild(btn)

      btn.addEventListener('click', () => runSimplify(strat.id, strat.name, btn))
    }
  }

  // Hide expand-only strategies on initial load (compact view)
  filterRules('')

  async function runSimplify(strategy: string, label: string, btn: HTMLButtonElement) {
    if (simplifyInProgress || applyInProgress) return
    simplifyInProgress = true
    btn.classList.add('working')

    try {
      const { json: before, nanoidToInt } = toJSONWithMap(app.graph, true)
      const beforeNodes = app.graph.nodes.size
      const beforeEdges = app.graph.edges.size

      const [resultJson, beforeInfo] = await Promise.all([
        pyzx.simplify(before, strategy),
        pyzx.graphInfo(before),
      ])

      const { newGraph, diff } = reconcileGraph(app.graph, resultJson, nanoidToInt)

      if (diff.removedNodeIds.size === 0 && diff.addedNodes.size === 0 &&
          diff.removedEdgeIds.size === 0 && diff.addedEdges.size === 0) {
        showToast(`<span class="toast-muted">${label}:</span> no changes`)
      } else {
        if (app.proof === null) {
          app.history.save(app.graph, label)
        }
        animateRewriteTransition(app, diff, newGraph)
        // Callback AFTER animateRewriteTransition so app.graph is updated
        if (app.proof !== null) {
          panelCallbacks?.onRewriteApplied?.(newGraph, label, strategy)
        }

        const afterNodes = newGraph.nodes.size
        const afterEdges = newGraph.edges.size
        const { json: afterJson } = toJSONWithMap(newGraph)
        const afterInfo = await pyzx.graphInfo(afterJson)

        let statsMsg =
          `<span class="toast-highlight">${label}</span> ` +
          `${beforeNodes} → ${afterNodes} nodes, ` +
          `${beforeEdges} → ${afterEdges} edges`
        if (beforeInfo.tcount !== afterInfo.tcount) {
          statsMsg += `, T-count: ${beforeInfo.tcount} → ${afterInfo.tcount}`
        }
        showToast(statsMsg)

        panelCallbacks?.onVerifyTensor?.(before, label)
        markDirty()
        onGraphChanged()
      }
    } catch (err) {
      console.error(`[RewritePanel] simplify("${strategy}") failed:`, err)
      showToast(`<span style="color:#c42b2b">${label} failed</span>`)
    } finally {
      btn.classList.remove('working')
      simplifyInProgress = false
      // Invalidate cached matches
      for (const s of ruleStates) {
        s.matches = []
        s.filteredMatches = []
        s.currentIndex = 0
        s.btn.disabled = true
        s.btn.classList.remove('has-matches')
        s.countEl.textContent = ''
        s.prevBtn.style.display = 'none'
        s.nextBtn.style.display = 'none'
      }
      app.idRemovalNodes.clear()
    }
  }

  // --- Expand toggle + search ---
  const searchBar = panelEl.querySelector('.rw-search-bar') as HTMLElement
  const searchInput = panelEl.querySelector('.rw-search-input') as HTMLInputElement
  const headerEl = panelEl.querySelector('.rw-header') as HTMLElement

  function filterRules(query: string) {
    const q = query.toLowerCase().trim()
    const expanded = panelEl.classList.contains('rw-expanded')
    for (const rs of activeRuleStates()) {
      const matchesSearch = !q || rs.rule.name.toLowerCase().includes(q)
      const visibleInMode = expanded || !rs.btn.dataset.expandOnly
      rs.btn.style.display = (matchesSearch && visibleInMode) ? '' : 'none'
    }
    if (simpGroup) {
      for (const btn of simpGroup.querySelectorAll<HTMLButtonElement>('.rw-simp-btn')) {
        const text = btn.textContent?.toLowerCase() || ''
        const matchesSearch = !q || text.includes(q)
        const visibleInMode = expanded || !btn.dataset.expandOnly
        btn.style.display = (matchesSearch && visibleInMode) ? '' : 'none'
      }
    }
    for (const group of panelEl.querySelectorAll('.rw-group')) {
      const cat = (group as HTMLElement).dataset.category
      // Never show stabilizer group unless stabilizer mode is on, and vice versa
      if (cat === 'stabilizer' && !stabilizerMode) { (group as HTMLElement).style.display = 'none'; continue }
      if (cat !== 'stabilizer' && cat !== 'simplify' && stabilizerMode) { (group as HTMLElement).style.display = 'none'; continue }
      const visible = group.querySelectorAll('.rw-rule-btn:not([style*="display: none"]), .rw-simp-btn:not([style*="display: none"])').length
      ;(group as HTMLElement).style.display = visible === 0 ? 'none' : ''
    }
  }

  searchInput.addEventListener('input', () => filterRules(searchInput.value))

  toggleBtn.addEventListener('click', () => {
    const expanding = !panelEl.classList.contains('rw-expanded')
    panelEl.classList.toggle('rw-expanded')
    searchBar.classList.toggle('hidden', !expanding)
    headerEl.textContent = expanding ? 'All Rewrites' : 'Rewrites'
    if (expanding) {
      searchInput.value = ''
      searchInput.focus()
      filterRules('')
    } else {
      filterRules('')
    }
  })

  // --- Unfuse partition mode ---
  let partitionContainer: HTMLElement | null = null
  let partitionNewPhaseInput: HTMLInputElement | null = null

  function enterUnfusePartition(rs: RuleButtonState) {
    if (rs.filteredMatches.length === 0) return
    const match = rs.filteredMatches[rs.currentIndex]
    const nodeId = match.nanoids[0]
    if (!nodeId) return
    enterUnfuseForNode(nodeId)
  }

  function enterUnfuseForNode(nodeId: string) {
    const node = app.graph.nodes.get(nodeId)
    if (!node) return

    // Snapshot graph state for apply
    const { json, nanoidToInt } = toJSONWithMap(app.graph, true)

    // Collect all incident edges (excluding self-loops)
    const allEdges: string[] = []
    const incidentSet = app.graph.incidentEdges.get(nodeId)
    if (incidentSet) {
      for (const edgeId of incidentSet) {
        const edge = app.graph.edges.get(edgeId)
        if (edge && edge.source !== edge.target) {
          allEdges.push(edgeId)
        }
      }
    }

    // Get the spider's phase
    const originalPhase: Phase = { ...node.phase }

    // All edges start on the "original" side (amber); user clicks to move to "new"
    const newSideEdges = new Set<string>()

    app.unfusePartition = {
      nodeId,
      nanoidToInt,
      graphJson: json,
      newSideEdges,
      allEdges,
      activeSide: 'original',
      originalPhase,
    }

    // Highlight the target spider
    app.rewriteHighlightNodes.clear()
    app.rewriteHighlightEdges.clear()
    app.rewriteHighlightNodes.add(nodeId)
    markDirty()

    buildPartitionUI()
  }

  function buildPartitionUI() {
    removePartitionUI()

    const partition = app.unfusePartition
    if (!partition) return

    // Find the unfuse button's parent group to insert after it
    const unfuseState = activeRuleStates().find(rs => rs.rule.pyzxName === 'unfuse')
    if (!unfuseState) return

    partitionContainer = document.createElement('div')
    partitionContainer.className = 'rw-unfuse-partition'

    // Sides row
    const sidesRow = document.createElement('div')
    sidesRow.className = 'rw-unfuse-sides'

    const originalSide = document.createElement('div')
    originalSide.className = 'rw-unfuse-side active-original'
    const originalLabel = document.createElement('div')
    originalLabel.className = 'rw-unfuse-side-label'
    originalLabel.textContent = 'Original'
    const originalCount = document.createElement('div')
    originalCount.className = 'rw-unfuse-side-count'

    let phaseSyncLock = false

    const origPhaseWrap = document.createElement('div')
    origPhaseWrap.className = 'rw-unfuse-phase-wrap'
    const origPhaseLabel_ = document.createElement('div')
    origPhaseLabel_.className = 'rw-unfuse-phase-label'
    origPhaseLabel_.textContent = 'Phase:'
    const origPhaseInput = document.createElement('input')
    origPhaseInput.type = 'text'
    origPhaseInput.className = 'rw-unfuse-phase-input'
    origPhaseInput.value = phaseToString(partition.originalPhase) || '0'
    origPhaseInput.placeholder = '0'
    origPhaseWrap.appendChild(origPhaseLabel_)
    origPhaseWrap.appendChild(origPhaseInput)
    originalSide.appendChild(originalLabel)
    originalSide.appendChild(origPhaseWrap)
    originalSide.appendChild(originalCount)

    const newSide = document.createElement('div')
    newSide.className = 'rw-unfuse-side active-new'
    const newLabel = document.createElement('div')
    newLabel.className = 'rw-unfuse-side-label'
    newLabel.textContent = 'New'
    const newCount = document.createElement('div')
    newCount.className = 'rw-unfuse-side-count'

    const newPhaseWrap = document.createElement('div')
    newPhaseWrap.className = 'rw-unfuse-phase-wrap'
    const newPhaseLabel_ = document.createElement('div')
    newPhaseLabel_.className = 'rw-unfuse-phase-label'
    newPhaseLabel_.textContent = 'Phase:'
    const newPhaseInput = document.createElement('input')
    newPhaseInput.type = 'text'
    newPhaseInput.className = 'rw-unfuse-phase-input'
    newPhaseInput.value = '0'
    newPhaseInput.placeholder = '0'
    newPhaseWrap.appendChild(newPhaseLabel_)
    newPhaseWrap.appendChild(newPhaseInput)
    newSide.appendChild(newLabel)
    newSide.appendChild(newPhaseWrap)
    newSide.appendChild(newCount)

    sidesRow.appendChild(originalSide)
    sidesRow.appendChild(newSide)
    partitionContainer.appendChild(sidesRow)

    // Phase auto-sync (sum must equal originalPhase)
    function syncPhaseField(source: HTMLInputElement, target: HTMLInputElement) {
      if (phaseSyncLock) return
      phaseSyncLock = true
      try {
        const val = source.value.trim()
        if (val === '' || val === '0') {
          target.value = phaseToString(partition!.originalPhase) || '0'
          return
        }
        const typed = parsePhase(val)
        const complement = addPhases(partition!.originalPhase, negatePhase(typed))
        target.value = phaseToString(complement) || '0'
      } catch {
        // Leave target unchanged on parse error
      } finally {
        phaseSyncLock = false
      }
    }

    origPhaseInput.addEventListener('input', () => syncPhaseField(origPhaseInput, newPhaseInput))
    newPhaseInput.addEventListener('input', () => syncPhaseField(newPhaseInput, origPhaseInput))

    // Prevent canvas shortcuts while typing
    for (const input of [origPhaseInput, newPhaseInput]) {
      input.addEventListener('keydown', (e) => {
        e.stopPropagation()
        if (e.key === 'Escape') cancelPartition()
      })
    }

    // Hint
    const hint = document.createElement('div')
    hint.className = 'rw-unfuse-hint'
    hint.textContent = 'Click edges to assign sides'
    partitionContainer.appendChild(hint)

    // Actions row
    const actionsRow = document.createElement('div')
    actionsRow.className = 'rw-unfuse-actions'

    const applyBtn = document.createElement('button')
    applyBtn.className = 'rw-unfuse-apply'
    applyBtn.textContent = 'Apply'

    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'rw-unfuse-cancel'
    cancelBtn.textContent = 'Cancel'

    actionsRow.appendChild(applyBtn)
    actionsRow.appendChild(cancelBtn)
    partitionContainer.appendChild(actionsRow)

    // Insert after the unfuse button
    unfuseState.btn.insertAdjacentElement('afterend', partitionContainer)

    function updateCounts() {
      const p = app.unfusePartition
      if (!p) return
      const newCount_ = p.newSideEdges.size
      const origCount_ = p.allEdges.length - newCount_
      originalCount.textContent = `Wires: ${origCount_}`
      newCount.textContent = `Wires: ${newCount_}`
      applyBtn.disabled = false
    }

    cancelBtn.addEventListener('click', () => {
      cancelPartition()
    })

    applyBtn.addEventListener('click', () => {
      applyUnfusePartition()
    })

    // Store update function on container for reuse
    ;(partitionContainer as HTMLElement & { _updateCounts?: () => void })._updateCounts = updateCounts
    partitionNewPhaseInput = newPhaseInput

    updateCounts()
  }

  function removePartitionUI() {
    if (partitionContainer) {
      partitionContainer.remove()
      partitionContainer = null
    }
    partitionNewPhaseInput = null
  }

  function cancelPartition() {
    app.unfusePartition = null
    app.rewriteHighlightNodes.clear()
    app.rewriteHighlightEdges.clear()
    removePartitionUI()
    markDirty()
  }

  function toggleUnfuseEdge(edgeId: string) {
    const partition = app.unfusePartition
    if (!partition) return

    // Only act on edges incident to the target spider
    if (!partition.allEdges.includes(edgeId)) return

    // Find the "other" endpoint of the clicked edge
    const edge = app.graph.edges.get(edgeId)
    if (!edge) return
    const otherEnd = edge.source === partition.nodeId ? edge.target : edge.source

    // Toggle ALL edges to the same neighbor together (multi-edge handling)
    const siblingEdges = partition.allEdges.filter(eid => {
      const e = app.graph.edges.get(eid)
      if (!e) return false
      const other = e.source === partition.nodeId ? e.target : e.source
      return other === otherEnd
    })

    // Toggle: if any sibling is on original, move all to new; otherwise move all to original
    const anyOnOriginal = siblingEdges.some(eid => !partition.newSideEdges.has(eid))
    for (const eid of siblingEdges) {
      if (anyOnOriginal) {
        partition.newSideEdges.add(eid)
      } else {
        partition.newSideEdges.delete(eid)
      }
    }

    // Update counts display
    const container = partitionContainer as HTMLElement & { _updateCounts?: () => void }
    container?._updateCounts?.()
    markDirty()
  }

  async function applyUnfusePartition() {
    const partition = app.unfusePartition
    if (!partition) return
    if (applyInProgress || simplifyInProgress) return

    applyInProgress = true

    // Collect the int IDs of the neighbors going to the new spider
    // For each edge on the "new" side, find the neighbor vertex
    const neighborIntIds = new Set<number>()
    for (const edgeId of partition.newSideEdges) {
      const edge = app.graph.edges.get(edgeId)
      if (!edge) continue
      const neighborNanoid = edge.source === partition.nodeId ? edge.target : edge.source
      const intId = partition.nanoidToInt.get(neighborNanoid)
      if (intId !== undefined) neighborIntIds.add(intId)
    }

    const vertexIntId = partition.nanoidToInt.get(partition.nodeId)
    if (vertexIntId === undefined) {
      applyInProgress = false
      return
    }

    // Build match array: [vertex, ...neighbors_for_new_spider]
    const matchIntIds = [vertexIntId, ...neighborIntIds]

    // Read phase for the new spider from the partition input
    let newPhase: Phase = { n: 0, d: 1 }
    if (partitionNewPhaseInput) {
      try {
        newPhase = parsePhase(partitionNewPhaseInput.value.trim() || '0')
      } catch {
        newPhase = { n: 0, d: 1 }
      }
    }
    const unfusePhase = { n: newPhase.n, d: newPhase.d }

    // Clear partition UI before applying
    const beforeJson = partition.graphJson
    const nanoidToInt = partition.nanoidToInt
    cancelPartition()

    try {
      const resultJson = await pyzx.applyRewrite(beforeJson, 'unfuse', matchIntIds, unfusePhase)
      const { newGraph, diff } = reconcileGraph(app.graph, resultJson, nanoidToInt)

      if (diff.removedNodeIds.size === 0 && diff.addedNodes.size === 0 &&
          diff.removedEdgeIds.size === 0 && diff.addedEdges.size === 0) {
        // No structural changes — unfuse had no effect
      } else {
        if (app.proof === null) {
          app.history.save(app.graph, 'Unfuse')
        }
        animateRewriteTransition(app, diff, newGraph)
        if (app.proof !== null) {
          panelCallbacks?.onRewriteApplied?.(newGraph, 'Unfuse', 'unfuse')
        }
        panelCallbacks?.onVerifyTensor?.(beforeJson, 'Unfuse')
        markDirty()
        onGraphChanged()
      }
    } catch (err) {
      console.error('[RewritePanel] applyUnfusePartition failed:', err)
    } finally {
      for (const s of ruleStates) {
        s.matches = []
        s.filteredMatches = []
        s.currentIndex = 0
        s.btn.disabled = true
        s.btn.classList.remove('has-matches')
        s.countEl.textContent = ''
        s.prevBtn.style.display = 'none'
        s.nextBtn.style.display = 'none'
      }
      app.idRemovalNodes.clear()
      applyInProgress = false
    }
  }

  // --- Apply rewrite ---
  let applyInProgress = false

  async function applyRewrite(rs: RuleButtonState) {
    if (applyInProgress || simplifyInProgress || rs.filteredMatches.length === 0) return
    applyInProgress = true

    const match = rs.filteredMatches[rs.currentIndex]

    // Clear highlight immediately so it doesn't flash during the transition
    app.rewriteHighlightNodes.clear()
    app.rewriteHighlightEdges.clear()
    markDirty()

    try {
      const { json, nanoidToInt } = toJSONWithMap(app.graph, true)

      // Re-derive int IDs from nanoids (query's intIds may be stale)
      const currentIntIds: number[] = []
      for (const nid of match.nanoids) {
        const intId = nanoidToInt.get(nid)
        if (intId === undefined) {
          // Stale match — node gone
          return
        }
        currentIntIds.push(intId)
      }

      const resultJson = await pyzx.applyRewrite(json, rs.rule.pyzxName, currentIntIds)

      // Reconcile: map surviving nodes back to nanoids
      const { newGraph, diff } = reconcileGraph(app.graph, resultJson, nanoidToInt)

      if (diff.removedNodeIds.size === 0 && diff.addedNodes.size === 0 &&
          diff.removedEdgeIds.size === 0 && diff.addedEdges.size === 0) {
        // No structural changes — rewrite had no effect
      } else {
        if (app.proof === null) {
          app.history.save(app.graph, rs.rule.name)
        }
        animateRewriteTransition(app, diff, newGraph)
        // Callback AFTER animateRewriteTransition so app.graph is updated
        if (app.proof !== null) {
          panelCallbacks?.onRewriteApplied?.(newGraph, rs.rule.name, rs.rule.pyzxName)
        }
        panelCallbacks?.onVerifyTensor?.(json, rs.rule.name)
        markDirty()
        onGraphChanged()
      }
    } catch (err) {
      console.error(`[RewritePanel] applyRewrite("${rs.rule.pyzxName}") failed:`, err)
    } finally {
      // Invalidate all cached matches to prevent stale re-application
      for (const s of ruleStates) {
        s.matches = []
        s.filteredMatches = []
        s.currentIndex = 0
        s.btn.disabled = true
        s.btn.classList.remove('has-matches')
        s.countEl.textContent = ''
        s.prevBtn.style.display = 'none'
        s.nextBtn.style.display = 'none'
      }
      app.idRemovalNodes.clear()
      applyInProgress = false
    }
  }

  // --- Query state ---
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let lastGraphJson = ''
  let lastSelectionKey = ''
  let intToNanoid: Map<number, string> = new Map()
  let queryInProgress = false
  let initInProgress = false

  function getSelectionKey(): string {
    if (app.selectedNodes.size === 0 && app.selectedEdges.size === 0) return ''
    const nodeIds = [...app.selectedNodes].sort().join(',')
    const edgeIds = [...app.selectedEdges].sort().join(',')
    return `${nodeIds}|${edgeIds}`
  }

  function scheduleQuery() {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(runQuery, DEBOUNCE_MS)
  }

  async function runQuery() {
    debounceTimer = null

    if (!pyzx.isReady()) {
      if (initInProgress) return
      initInProgress = true
      statusEl.textContent = 'Loading engine\u2026'
      try {
        await pyzx.init()
      } catch (err) {
        console.error('[RewritePanel] PyZX init failed:', err)
        statusEl.textContent = 'Engine failed to load'
        initInProgress = false
        return
      }
      initInProgress = false
      statusEl.textContent = ''
      panelCallbacks?.onEngineReady?.()
    }

    // Export graph (circuit-space so PyZX gets clean row/qubit values)
    const { json, nanoidToInt } = toJSONWithMap(app.graph, true)
    const selectionKey = getSelectionKey()

    // Cache check: skip if graph + selection unchanged
    if (json === lastGraphJson && selectionKey === lastSelectionKey) return

    lastGraphJson = json
    lastSelectionKey = selectionKey

    // Build reverse map (int → nanoid)
    intToNanoid = new Map()
    for (const [nanoid, intId] of nanoidToInt) {
      intToNanoid.set(intId, nanoid)
    }

    if (queryInProgress) return
    queryInProgress = true

    // Collect the set of selected nodes as int IDs for filtering
    const selectedIntIds = new Set<number>()
    for (const nodeId of app.selectedNodes) {
      const intId = nanoidToInt.get(nodeId)
      if (intId !== undefined) selectedIntIds.add(intId)
    }

    // Collect selected edge endpoint pairs (for edge-based rules like wire_vertex)
    const selectedEdgePairs = new Set<string>()
    for (const edgeId of app.selectedEdges) {
      const edge = app.graph.edges.get(edgeId)
      if (!edge) continue
      const sInt = nanoidToInt.get(edge.source)
      const tInt = nanoidToInt.get(edge.target)
      if (sInt !== undefined && tInt !== undefined) {
        const lo = Math.min(sInt, tInt)
        const hi = Math.max(sInt, tInt)
        selectedEdgePairs.add(`${lo},${hi}`)
      }
    }

    const hasSelection = selectedIntIds.size > 0 || selectedEdgePairs.size > 0

    statusEl.textContent = ''
    const activeStates = activeRuleStates()

    try {
      // Batch: one worker message for all rules (one graph load, one round-trip)
      const ruleNames = activeStates.map(rs => rs.rule.pyzxName)
      const [allMatches, graphInfoResult] = await Promise.all([
        pyzx.findAllMatches(json, ruleNames),
        pyzx.graphInfo(json),
      ])

      // Update persistent stats bar
      if (statsEl) {
        const parts = [
          `${graphInfoResult.num_vertices} nodes`,
          `${graphInfoResult.num_edges} edges`,
        ]
        if (graphInfoResult.tcount > 0) {
          parts.push(`T-count: ${graphInfoResult.tcount}`)
        }
        statsEl.textContent = parts.join(' \u00b7 ')
      }

      for (const rs of activeStates) {
        const matches = allMatches[rs.rule.pyzxName] ?? []
        rs.matches = matches

        rs.filteredMatches = []
        for (const match of matches) {
          const nanoids = match.map(intId => intToNanoid.get(intId)).filter((id): id is string => id !== undefined)
          if (nanoids.length === 0) continue

          if (hasSelection) {
            // Edge-based rules: filter by selected edges
            if (rs.rule.pyzxName === 'wire_vertex' && selectedEdgePairs.size > 0) {
              if (match.length === 2) {
                const lo = Math.min(match[0], match[1])
                const hi = Math.max(match[0], match[1])
                if (!selectedEdgePairs.has(`${lo},${hi}`)) continue
              } else {
                continue
              }
            } else if (selectedIntIds.size === 1) {
              // Exploratory: show any match involving the selected node
              const involvesSelected = match.some(intId => selectedIntIds.has(intId))
              if (!involvesSelected) continue
            } else if (selectedIntIds.size > 1) {
              if (match.length > selectedIntIds.size) {
                // Compound match larger than selection:
                // show if all selected vertices are part of this match
                const matchSet = new Set(match)
                const allSelectedInMatch = [...selectedIntIds].every(id => matchSet.has(id))
                if (!allSelectedInMatch) continue
              } else {
                // Targeted: all match vertices must be within the selection
                const allInSelection = match.every(intId => selectedIntIds.has(intId))
                if (!allInSelection) continue
              }
            } else if (selectedEdgePairs.size > 0 && rs.rule.pyzxName !== 'wire_vertex') {
              // Only edges selected, no nodes — skip non-edge rules
              continue
            }
          }

          rs.filteredMatches.push({ nanoids, intIds: match })
        }
      }
    } catch (err) {
      console.warn('[RewritePanel] findAllMatches failed:', err)
      for (const rs of activeStates) {
        rs.matches = []
        rs.filteredMatches = []
      }
    } finally {
      queryInProgress = false
    }

    // If graph/selection changed while querying, the matches we just received are
    // stale — clear them immediately so the user can't click wrong targets, then
    // re-query against the current graph.
    const currentJson = toJSONWithMap(app.graph, true).json
    const currentSelKey = getSelectionKey()
    if (currentJson !== lastGraphJson || currentSelKey !== lastSelectionKey) {
      for (const s of activeStates) {
        s.matches = []
        s.filteredMatches = []
        s.currentIndex = 0
      }
      app.idRemovalNodes.clear()
      updateButtons(hasSelection)
      scheduleQuery()
      return
    }

    // Expose id_removal match nanoid IDs for one-click overlay on canvas
    // Use ALL matches (not selection-filtered) so X marks stay visible regardless of selection
    app.idRemovalNodes.clear()
    for (const rs of activeStates) {
      if (rs.rule.pyzxName === 'id_removal') {
        for (const match of rs.matches) {
          const nanoids = match.map(intId => intToNanoid.get(intId)).filter((id): id is string => id !== undefined)
          for (const nid of nanoids) {
            app.idRemovalNodes.add(nid)
          }
        }
        break
      }
    }

    // Expose hopf-eligible edges for one-click cut overlay on canvas
    // (not available in stabilizer mode — no Hopf rule)
    app.hopfCutEdges.clear()
    if (!stabilizerMode) {
      for (const rs of activeStates) {
        if (rs.rule.pyzxName === 'hopf') {
          for (const match of rs.matches) {
            if (match.length !== 2) continue
            const nid0 = intToNanoid.get(match[0])
            const nid1 = intToNanoid.get(match[1])
            if (!nid0 || !nid1) continue
            // Find all edges between this vertex pair
            for (const edge of app.graph.edges.values()) {
              if ((edge.source === nid0 && edge.target === nid1) ||
                  (edge.source === nid1 && edge.target === nid0)) {
                app.hopfCutEdges.set(edge.id, [nid0, nid1])
              }
            }
          }
          break
        }
      }
    }

    updateButtons(hasSelection)
  }

  function updateButtons(hasSelection: boolean) {
    for (const rs of activeRuleStates()) {
      const count = rs.filteredMatches.length
      const hasMatches = count > 0

      // Reset index when matches change
      if (rs.currentIndex >= count) rs.currentIndex = 0

      rs.btn.disabled = !hasMatches
      rs.btn.classList.toggle('has-matches', hasMatches)
      updateCountDisplay(rs)
    }

    if (simpGroup && !stabilizerMode) {
      for (const btn of simpGroup.querySelectorAll<HTMLButtonElement>('.rw-simp-btn')) {
        btn.disabled = false
      }
    }

    // Show branching warning when viewing a past step with future steps
    if (app.proofViewingPast && app.proof && app.proof.currentStep < app.proof.steps.length - 1) {
      const stepNum = app.proof.currentStep + 1
      statusEl.innerHTML = `<span style="color:#c89020">Editing from step ${stepNum} — future steps will be replaced</span>`
    } else if (!hasSelection && ruleStates.every(rs => rs.filteredMatches.length === 0)) {
      statusEl.textContent = 'Select elements to see rewrites'
    } else {
      statusEl.textContent = ''
    }
  }

  // --- Stabilizer mode change handler ---
  window.addEventListener('zx-stabilizer-mode-changed', () => {
    stabilizerMode = localStorage.getItem(STABILIZER_KEY) === '1'
    applyModeVisibility()
    // Clear cached matches
    lastGraphJson = ''
    lastSelectionKey = ''
    for (const rs of [...ruleStates, ...stabilizerRuleStates]) {
      rs.matches = []
      rs.filteredMatches = []
      rs.currentIndex = 0
      rs.btn.disabled = true
      rs.btn.classList.remove('has-matches')
      rs.countEl.textContent = ''
      rs.prevBtn.style.display = 'none'
      rs.nextBtn.style.display = 'none'
    }
    app.idRemovalNodes.clear()
    app.hopfCutEdges.clear()
    scheduleQuery()
  })

  // Fire initial query
  scheduleQuery()

  return {
    onSelectionChanged() {
      scheduleQuery()
    },
    onGraphChanged() {
      // Auto-cancel unfuse partition if graph changes underneath
      if (app.unfusePartition) {
        cancelPartition()
      }
      scheduleQuery()
    },
    toggleUnfuseEdge(edgeId: string) {
      toggleUnfuseEdge(edgeId)
    },
    cancelUnfusePartition() {
      cancelPartition()
    },
    enterUnfuseForNode(nodeId: string) {
      enterUnfuseForNode(nodeId)
    },
  }
}
