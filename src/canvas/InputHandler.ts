import type { CameraState } from './Camera.ts'
import { pan, zoomAt, screenToWorld } from './Camera.ts'
import { hitTest, rebuildSpatialIndex, nodesInRect } from './HitTest.ts'
import type { AppState } from '../AppState.ts'
import { NodeType, EdgeType } from '../model/types.ts'
import { addNode, addEdge, removeNode, removeEdge, moveNode, setNodeType, degree, fuseSpiders, edgesBetween, extractSubgraph, mergeSubgraph } from '../model/Graph.ts'
import { phaseToString } from '../model/Phase.ts'
import { SPIDER_RADIUS, HOPF_CUT_HALF } from './elements.ts'
import { hapticTap } from '../haptics.ts'


export interface InputCallbacks {
  /** Returns the NodeType for the currently active palette tool, or null if not a node tool. */
  getPlacementNodeType: () => NodeType | null
  /** Returns the EdgeType for the currently active palette tool. */
  getPlacementEdgeType: () => EdgeType
  /** Show context menu for a node. */
  showContextMenuForNode: (nodeId: string) => void
  /** Show context menu for an edge. */
  showContextMenuForEdge: (edgeId: string) => void
  /** Dismiss any open context menu. */
  dismissContextMenu: () => void
  /** Called after any graph mutation so toolbar can update. */
  onGraphChanged: () => void
  /** Called whenever the selection (selectedNodes or selectedEdges) changes. */
  onSelectionChanged?: () => void
  /** Called after a drag-to-fuse completes successfully (outside proof mode). */
  onFusionApplied?: () => void
  /** Called to request a PyZX-verified fusion in proof mode. */
  onProofFusion?: (targetId: string, draggedId: string) => void
  /** Returns true when direct graph editing is locked (proof mode). */
  isEditingLocked?: () => boolean
  /** Intercept Cmd+Z in proof mode. Return true if handled. */
  onProofUndo?: () => boolean
  /** Intercept Cmd+Shift+Z in proof mode. Return true if handled. */
  onProofRedo?: () => boolean
  /** Switch palette tool by index (1=Z, 2=X, 3=Boundary, 4=Hadamard). */
  setPaletteTool?: (index: number) => void
  /** Toggle keyboard shortcuts overlay. */
  toggleShortcutsOverlay?: () => void
  /** Apply color change rewrite on a spider via PyZX. */
  onColorChangeRewrite?: (nodeId: string) => void
  /** Returns the active palette tool id (e.g. 'z', 'x', 'boundary', 'hadamard'). */
  getActiveTool?: () => string
  /** Apply wire_vertex rewrite on an edge (insert phaseless identity spider). clickWorld = where the user double-clicked. */
  onWireVertex?: (edgeId: string, clickWorld: { x: number; y: number }) => void
  /** One-click identity removal on a spider (proof mode). */
  onIdRemoval?: (nodeId: string) => void
  /** Returns the set of node IDs eligible for one-click identity removal. */
  getIdRemovalNodes?: () => Set<string>
  /** One-click Hopf cut on an edge (proof mode). Passes vertex pair nanoids. */
  onHopfCut?: (v1: string, v2: string) => void
  /** Returns the map of edge IDs eligible for Hopf cut → [v1, v2] nanoids. */
  getHopfCutEdges?: () => Map<string, [string, string]>
  /** Returns true when unfuse partition mode is active. */
  isUnfusePartitionActive?: () => boolean
  /** Toggle an edge between sides during unfuse partition. */
  onUnfuseEdgeToggle?: (edgeId: string) => void
  /** Cancel unfuse partition mode. */
  onUnfuseCancel?: () => void
}

// --- Constants ---
const DRAG_THRESHOLD = 5     // px in screen space
const DOUBLE_CLICK_MS = 350  // max time between clicks for double-click
const PAN_FRICTION = 0.92
const VELOCITY_THRESHOLD = 0.5
const WIRE_TARGET_RADIUS = 30 // px in world space — snap radius for wire target detection
const TOUCH_HIT_PADDING = 8  // extra px for touch hit-test tolerance
const LONG_PRESS_MS = 500
const LONG_PRESS_MOVE_THRESHOLD = 10 // px screen space

// --- FSM States ---
type State =
  | { type: 'idle' }
  | { type: 'pointing_node'; nodeId: string; startX: number; startY: number; zone: 'move' | 'wire' }
  | { type: 'dragging_node'; nodeIds: string[]; startWorldPositions: Map<string, { x: number; y: number }>; lastX: number; lastY: number }
  | { type: 'dragging_wire'; sourceNodeId: string }
  | { type: 'pointing_canvas'; startX: number; startY: number; shift: boolean }
  | { type: 'panning'; lastX: number; lastY: number }
  | { type: 'selection_box'; startWX: number; startWY: number; currentWX: number; currentWY: number }

/**
 * Sets up all pointer, wheel, and keyboard event listeners.
 */
export function setupInput(
  canvas: HTMLCanvasElement,
  camera: CameraState,
  app: AppState,
  markDirty: () => void,
  callbacks?: InputCallbacks,
): { tick: (dt: number) => void; destroy: () => void } {
  let state: State = { type: 'idle' }
  let lastClickTime = 0
  let lastClickX = 0
  let lastClickY = 0
  let lastNodeClickTime = 0
  let lastNodeClickId = ''
  let lastEdgeClickTime = 0
  let lastEdgeClickId = ''
  let currentCursor = ''
  function setCursor(value: string) {
    if (value !== currentCursor) {
      currentCursor = value
      canvas.style.cursor = value
    }
  }

  // --- Touch state (all gated by pointerType === 'touch') ---
  const activePointers = new Map<number, { x: number; y: number }>()
  let pinchState: { lastDist: number; lastMidX: number; lastMidY: number } | null = null
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let longPressFired = false
  let longPressStartX = 0
  let longPressStartY = 0

  function clearLongPress() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }

  function cancelCurrentInteraction() {
    if (state.type === 'dragging_wire') {
      app.wireSourceNode = null
      app.wireTargetNode = null
      app.wireCursorWorld = null
      clearInteractionCanvas()
    }
    if (state.type === 'dragging_node') {
      app.fusionTargetNode = null
    }
    state = { type: 'idle' }
    markDirty()
  }

  function touchPadding(e: PointerEvent): number {
    return e.pointerType === 'touch' ? TOUCH_HIT_PADDING : 0
  }

  function notifySelectionChanged() {
    callbacks?.onSelectionChanged?.()
  }

  // Velocity tracking for pan momentum
  const velocity = { x: 0, y: 0 }
  const recentDeltas: Array<{ dx: number; dy: number; dt: number }> = []
  let lastPointerTime = 0

  // Interaction overlay context (the top canvas)
  const interactionCtx = canvas.getContext('2d')!

  // --- Pointer events ---

  function onPointerDown(e: PointerEvent) {
    // Dismiss context menu on any canvas interaction
    callbacks?.dismissContextMenu()

    // --- Touch pointer tracking ---
    if (e.pointerType === 'touch') {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (activePointers.size > 2) return  // ignore 3+ fingers

      if (activePointers.size === 2) {
        // Second finger down → enter pinch mode
        clearLongPress()
        longPressFired = false
        cancelCurrentInteraction()

        const pts = [...activePointers.values()]
        const dx = pts[1].x - pts[0].x
        const dy = pts[1].y - pts[0].y
        pinchState = {
          lastDist: Math.sqrt(dx * dx + dy * dy),
          lastMidX: (pts[0].x + pts[1].x) / 2,
          lastMidY: (pts[0].y + pts[1].y) / 2,
        }

        // Release any pointer captures so both fingers track
        try { canvas.releasePointerCapture(e.pointerId) } catch { /* ok */ }
        for (const id of activePointers.keys()) {
          try { canvas.releasePointerCapture(id) } catch { /* ok */ }
        }
        return
      }

      // Single finger — start long-press timer
      longPressFired = false
      longPressStartX = e.clientX
      longPressStartY = e.clientY
      clearLongPress()
      longPressTimer = setTimeout(() => {
        longPressTimer = null
        longPressFired = true
        // Hit-test at the long-press position
        cancelCurrentInteraction()
        const w = screenToWorld(camera, longPressStartX, longPressStartY)
        const h = hitTest(app.graph, w.x, w.y, camera.zoom, TOUCH_HIT_PADDING)
        if (h?.type === 'node') {
          callbacks?.showContextMenuForNode(h.nodeId)
        } else if (h?.type === 'edge') {
          callbacks?.showContextMenuForEdge(h.edgeId)
        }
      }, LONG_PRESS_MS)
    }

    if (e.button === 1) {
      // Middle-mouse always pans
      state = { type: 'panning', lastX: e.clientX, lastY: e.clientY }
      resetVelocity()
      canvas.setPointerCapture(e.pointerId)
      return
    }

    if (e.button !== 0) return
    // Only capture when not in multi-touch
    if (activePointers.size <= 1) {
      canvas.setPointerCapture(e.pointerId)
    }

    const world = screenToWorld(camera, e.clientX, e.clientY)
    const hit = hitTest(app.graph, world.x, world.y, camera.zoom, touchPadding(e))

    // One-click Hopf cut in proof mode — check ALL cut lines regardless of what was hit
    if (callbacks?.isEditingLocked?.()) {
      const hopfCutEdges = callbacks.getHopfCutEdges?.()
      if (hopfCutEdges && hopfCutEdges.size > 0) {
        // Deduplicate by vertex pair
        const checkedPairs = new Set<string>()
        for (const [, match] of hopfCutEdges) {
          const key = match[0] < match[1] ? `${match[0]}:${match[1]}` : `${match[1]}:${match[0]}`
          if (checkedPairs.has(key)) continue
          checkedPairs.add(key)
          const n0 = app.graph.nodes.get(match[0])
          const n1 = app.graph.nodes.get(match[1])
          if (!n0 || !n1) continue
          const mx = (n0.x + n1.x) / 2
          const my = (n0.y + n1.y) / 2
          const offx = world.x - mx
          const offy = world.y - my
          const edx = n1.x - n0.x
          const edy = n1.y - n0.y
          const elen = Math.sqrt(edx * edx + edy * edy) || 1
          const px = -edy / elen
          const py = edx / elen
          const projCut = Math.abs(offx * px + offy * py)
          const projEdge = Math.abs(offx * edx / elen + offy * edy / elen)
          if (projCut <= HOPF_CUT_HALF + 6 && projEdge <= 10) {
            callbacks.onHopfCut?.(match[0], match[1])
            state = { type: 'idle' }
            return
          }
        }
      }
    }

    // Unfuse partition mode: intercept edge clicks incident to the target spider
    if (callbacks?.isUnfusePartitionActive?.() && hit?.type === 'edge') {
      callbacks.onUnfuseEdgeToggle?.(hit.edgeId)
      state = { type: 'idle' }
      return
    }

    if (hit && hit.type === 'node') {
      state = { type: 'pointing_node', nodeId: hit.nodeId, startX: e.clientX, startY: e.clientY, zone: hit.zone }
    } else if (hit && hit.type === 'edge') {
      const now = performance.now()

      // Double-click on same edge
      if (now - lastEdgeClickTime < DOUBLE_CLICK_MS && hit.edgeId === lastEdgeClickId) {
        lastEdgeClickTime = 0
        lastEdgeClickId = ''
        if (callbacks?.getActiveTool?.() === 'hadamard') {
          // Hadamard tool → toggle Hadamard
          if (!callbacks?.isEditingLocked?.()) {
            const edge = app.graph.edges.get(hit.edgeId)
            if (edge) {
              app.history.save(app.graph, 'Toggle Hadamard')
              const newType = edge.type === EdgeType.Hadamard ? EdgeType.Simple : EdgeType.Hadamard
              app.graph.edges.set(hit.edgeId, { ...edge, type: newType })
              markDirty()
              callbacks?.onGraphChanged()
            }
          }
        } else {
          // Any other tool → add wire vertex (if not a self-loop)
          const edge = app.graph.edges.get(hit.edgeId)
          if (edge && edge.source !== edge.target) {
            callbacks?.onWireVertex?.(hit.edgeId, world)
          }
        }
        state = { type: 'idle' }
      } else {
        lastEdgeClickTime = now
        lastEdgeClickId = hit.edgeId

        // Click on edge → select it
        if (!e.shiftKey) {
          app.selectedNodes.clear()
          app.selectedEdges.clear()
        }
        if (app.selectedEdges.has(hit.edgeId)) {
          app.selectedEdges.delete(hit.edgeId)
        } else {
          app.selectedEdges.add(hit.edgeId)
        }
        notifySelectionChanged()
        markDirty()
        state = { type: 'idle' }
      }
    } else {
      // Empty canvas
      state = { type: 'pointing_canvas', startX: e.clientX, startY: e.clientY, shift: e.shiftKey }
      resetVelocity()
      lastPointerTime = performance.now()
    }
  }

  function onPointerMove(e: PointerEvent) {
    // --- Touch pointer tracking ---
    if (e.pointerType === 'touch') {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

      // Cancel long-press if moved too far
      if (longPressTimer !== null) {
        const dx = e.clientX - longPressStartX
        const dy = e.clientY - longPressStartY
        if (Math.sqrt(dx * dx + dy * dy) > LONG_PRESS_MOVE_THRESHOLD) {
          clearLongPress()
        }
      }

      // Pinch-to-zoom handling
      if (pinchState && activePointers.size === 2) {
        const pts = [...activePointers.values()]
        const dx = pts[1].x - pts[0].x
        const dy = pts[1].y - pts[0].y
        const newDist = Math.sqrt(dx * dx + dy * dy)
        const midX = (pts[0].x + pts[1].x) / 2
        const midY = (pts[0].y + pts[1].y) / 2

        // Zoom by distance ratio
        if (pinchState.lastDist > 0) {
          const scale = newDist / pinchState.lastDist
          zoomAt(camera, midX, midY, scale)
        }

        // Pan by midpoint delta
        const panDx = midX - pinchState.lastMidX
        const panDy = midY - pinchState.lastMidY
        pan(camera, panDx, panDy)

        pinchState.lastDist = newDist
        pinchState.lastMidX = midX
        pinchState.lastMidY = midY
        markDirty()
        return
      }
    }

    const world = screenToWorld(camera, e.clientX, e.clientY)

    switch (state.type) {
      case 'idle': {
        // Touch has no hover — skip hover/cursor updates
        if (e.pointerType === 'touch') break

        // Update hover
        const hit = hitTest(app.graph, world.x, world.y, camera.zoom)
        const newHoveredNode = hit?.type === 'node' ? hit.nodeId : null
        const newHoveredEdge = hit?.type === 'edge' ? hit.edgeId : null
        if (newHoveredNode !== app.hoveredNode || newHoveredEdge !== app.hoveredEdge) {
          app.hoveredNode = newHoveredNode
          app.hoveredEdge = newHoveredEdge
          markDirty()
        }
        // Always update hover world position for partial edge highlighting, id-removal hitbox, and Hopf cut lines
        let needsHoverWorld = !!(newHoveredEdge || (newHoveredNode && callbacks?.getIdRemovalNodes?.().has(newHoveredNode)))
        if (!needsHoverWorld && callbacks?.isEditingLocked?.()) {
          const hopfCutEdges = callbacks.getHopfCutEdges?.()
          if (hopfCutEdges && hopfCutEdges.size > 0) {
            const checkedPairs = new Set<string>()
            for (const [, match] of hopfCutEdges) {
              const key = match[0] < match[1] ? `${match[0]}:${match[1]}` : `${match[1]}:${match[0]}`
              if (checkedPairs.has(key)) continue
              checkedPairs.add(key)
              const n0 = app.graph.nodes.get(match[0])
              const n1 = app.graph.nodes.get(match[1])
              if (!n0 || !n1) continue
              const mx = (n0.x + n1.x) / 2
              const my = (n0.y + n1.y) / 2
              const offx = world.x - mx
              const offy = world.y - my
              const edx = n1.x - n0.x
              const edy = n1.y - n0.y
              const elen = Math.sqrt(edx * edx + edy * edy) || 1
              const px = -edy / elen
              const py = edx / elen
              const projCut = Math.abs(offx * px + offy * py)
              const projEdge = Math.abs(offx * py - offy * px)
              if (projCut <= HOPF_CUT_HALF + 6 && projEdge <= 10) {
                needsHoverWorld = true
                break
              }
            }
          }
        }
        if (needsHoverWorld) {
          app.hoverWorld = { x: world.x, y: world.y }
          markDirty()
        } else {
          app.hoverWorld = null
        }

        // Update cursor based on hover target
        if (hit?.type === 'node') {
          setCursor('grab')
        } else {
          setCursor('')
        }
        break
      }

      case 'pointing_node': {
        const dx = e.clientX - state.startX
        const dy = e.clientY - state.startY
        if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
          const activeTool = callbacks?.getActiveTool?.()
          if (state.zone === 'wire' && !callbacks?.isEditingLocked?.() && (activeTool === 'boundary' || activeTool === 'hadamard')) {
            // Transition to wire creation (Wire or Hadamard tool)
            state = { type: 'dragging_wire', sourceNodeId: state.nodeId }
            app.wireSourceNode = state.sourceNodeId
            app.wireCursorWorld = { x: world.x, y: world.y }
            setCursor('')
            markDirty()
          } else {
            // Transition to node dragging
            if (!app.selectedNodes.has(state.nodeId)) {
              app.selectedNodes.clear()
              app.selectedEdges.clear()
              app.selectedNodes.add(state.nodeId)
              notifySelectionChanged()
            }

            // Save snapshot for undo before dragging starts
            app.history.save(app.graph, 'Move')

            // Record start positions of all selected nodes
            const startPositions = new Map<string, { x: number; y: number }>()
            for (const id of app.selectedNodes) {
              const node = app.graph.nodes.get(id)
              if (node) startPositions.set(id, { x: node.x, y: node.y })
            }

            state = {
              type: 'dragging_node',
              nodeIds: [...app.selectedNodes],
              startWorldPositions: startPositions,
              lastX: e.clientX,
              lastY: e.clientY,
            }
            setCursor('grabbing')
            markDirty()
          }
        }
        break
      }

      case 'dragging_node': {
        const dx = (e.clientX - state.lastX) / camera.zoom
        const dy = (e.clientY - state.lastY) / camera.zoom
        state.lastX = e.clientX
        state.lastY = e.clientY

        // Move all selected nodes
        for (const id of state.nodeIds) {
          const node = app.graph.nodes.get(id)
          if (node) {
            moveNode(app.graph, id, node.x + dx, node.y + dy)
          }
        }
        rebuildSpatialIndex(app.graph)

        // Fusion detection: only when dragging a single spider
        app.fusionTargetNode = null
        if (state.nodeIds.length === 1) {
          const draggedNode = app.graph.nodes.get(state.nodeIds[0])
          if (draggedNode && draggedNode.type !== NodeType.Boundary) {
            // Find overlapping spider (within fusion radius)
            const fusionRadius = SPIDER_RADIUS * 2.2
            for (const candidate of app.graph.nodes.values()) {
              if (candidate.id === draggedNode.id) continue
              if (candidate.type === NodeType.Boundary) continue
              const cdx = draggedNode.x - candidate.x
              const cdy = draggedNode.y - candidate.y
              const dist = Math.sqrt(cdx * cdx + cdy * cdy)
              if (dist < fusionRadius && candidate.type === draggedNode.type) {
                // Valid spider fusion requires a connecting simple edge
                const connecting = edgesBetween(app.graph, state.nodeIds[0], candidate.id)
                const hasSimpleEdge = connecting.some(e => e.type === EdgeType.Simple)
                if (hasSimpleEdge) {
                  app.fusionTargetNode = candidate.id
                }
                break
              }
            }
          }
        }

        markDirty()
        break
      }

      case 'dragging_wire': {
        app.wireCursorWorld = { x: world.x, y: world.y }

        // Find nearest node as connection target
        const hit = hitTest(app.graph, world.x, world.y, camera.zoom, touchPadding(e))
        let candidateId: string | null = null

        if (hit?.type === 'node') {
          candidateId = hit.nodeId
        } else {
          // Broader search: find nearest node within snap radius
          candidateId = findNearestNode(world.x, world.y)
        }

        // Validate candidate — can we connect to it?
        if (candidateId) {
          const candidateNode = app.graph.nodes.get(candidateId)
          if (candidateNode) {
            // Boundary nodes reject if already have an edge (unless it's a self-loop to the source)
            if (candidateNode.type === NodeType.Boundary && candidateId !== state.sourceNodeId) {
              const deg = degree(app.graph, candidateId)
              if (deg >= 1) candidateId = null
            }
          }
        }

        app.wireTargetNode = candidateId
        drawProvisionalWire()
        markDirty()
        break
      }

      case 'pointing_canvas': {
        const dx = e.clientX - state.startX
        const dy = e.clientY - state.startY
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist > DRAG_THRESHOLD) {
          if (state.shift) {
            // Shift+drag → box select
            const startWorld = screenToWorld(camera, state.startX, state.startY)
            state = {
              type: 'selection_box',
              startWX: startWorld.x,
              startWY: startWorld.y,
              currentWX: world.x,
              currentWY: world.y,
            }
          } else {
            // Regular drag → pan
            state = { type: 'panning', lastX: e.clientX, lastY: e.clientY }
            // Apply the initial delta we missed
            pan(camera, dx, dy)
            markDirty()
          }
        }
        break
      }

      case 'panning': {
        const dx = e.clientX - state.lastX
        const dy = e.clientY - state.lastY
        const now = performance.now()
        const dt = now - lastPointerTime

        pan(camera, dx, dy)
        markDirty()

        // Track velocity for momentum
        if (dt > 0) {
          recentDeltas.push({ dx, dy, dt })
          trimDeltas()
        }

        state.lastX = e.clientX
        state.lastY = e.clientY
        lastPointerTime = now
        setCursor('grabbing')
        break
      }

      case 'selection_box': {
        state.currentWX = world.x
        state.currentWY = world.y
        markDirty()

        // Draw the selection box on the interaction layer
        drawSelectionBox()
        break
      }
    }
  }

  function onPointerUp(e: PointerEvent) {
    // --- Touch cleanup ---
    if (e.pointerType === 'touch') {
      activePointers.delete(e.pointerId)
      clearLongPress()

      // If pinch was active, wait for all fingers up then reset
      if (pinchState) {
        if (activePointers.size < 2) pinchState = null
        if (activePointers.size > 0) return  // wait for last finger
        state = { type: 'idle' }
        return
      }

      // If long-press fired, consume the event (don't click/select)
      if (longPressFired) {
        longPressFired = false
        state = { type: 'idle' }
        return
      }
    }

    switch (state.type) {
      case 'pointing_node': {
        const now = performance.now()

        // One-click identity removal in proof mode — tiny hitbox at spider center
        if (callbacks?.isEditingLocked?.() && callbacks?.getIdRemovalNodes?.().has(state.nodeId)) {
          const node = app.graph.nodes.get(state.nodeId)
          if (node) {
            const clickWorld = screenToWorld(camera, state.startX, state.startY)
            const dx = clickWorld.x - node.x
            const dy = clickWorld.y - node.y
            if (Math.sqrt(dx * dx + dy * dy) <= SPIDER_RADIUS * 0.35) {
              callbacks.onIdRemoval?.(state.nodeId)
              break
            }
          }
        }

        // Double-click on same spider → color change rewrite via PyZX
        if (now - lastNodeClickTime < DOUBLE_CLICK_MS && state.nodeId === lastNodeClickId) {
          lastNodeClickTime = 0
          lastNodeClickId = ''
          const node = app.graph.nodes.get(state.nodeId)
          if (node && node.type !== NodeType.Boundary) {
            callbacks?.onColorChangeRewrite?.(state.nodeId)
          }
          break
        }

        lastNodeClickTime = now
        lastNodeClickId = state.nodeId

        // Click (no drag) → select/deselect
        if (e.shiftKey) {
          // Toggle selection
          if (app.selectedNodes.has(state.nodeId)) {
            app.selectedNodes.delete(state.nodeId)
          } else {
            app.selectedNodes.add(state.nodeId)
          }
        } else {
          app.selectedNodes.clear()
          app.selectedEdges.clear()
          app.selectedNodes.add(state.nodeId)
        }
        notifySelectionChanged()
        markDirty()
        break
      }

      case 'dragging_node': {
        const fusionTarget = app.fusionTargetNode
        app.fusionTargetNode = null

        if (fusionTarget && state.nodeIds.length === 1) {
          const draggedId = state.nodeIds[0]
          const draggedNode = app.graph.nodes.get(draggedId)
          const targetNode = app.graph.nodes.get(fusionTarget)

          // Validate: same color + connected by simple edge
          const connecting = draggedNode && targetNode
            ? edgesBetween(app.graph, draggedId, fusionTarget)
            : []
          const hasSimpleEdge = connecting.some(e => e.type === EdgeType.Simple)

          if (draggedNode && targetNode && draggedNode.type === targetNode.type && hasSimpleEdge) {
            // Capture ghost at the current drag position (before undo moves it back)
            const ghostX = draggedNode.x
            const ghostY = draggedNode.y
            app.animations.animateFusionCollapse({
              id: draggedId, x: ghostX, y: ghostY,
              type: draggedNode.type, phaseLabel: phaseToString(draggedNode.phase),
              anim: null!,  // filled by animateFusionCollapse
            }, targetNode.x, targetNode.y)

            // Undo the move snapshot (saved at drag start)
            app.history.undo(app.graph)

            if (callbacks?.onProofFusion && callbacks?.isEditingLocked?.()) {
              // Proof mode: route through PyZX for verified fusion
              app.selectedNodes.clear()
              app.selectedEdges.clear()
              notifySelectionChanged()
              callbacks.onProofFusion(fusionTarget, draggedId)
            } else {
              // Normal mode: use TS fusion
              app.history.save(app.graph, 'Fuse spiders')
              fuseSpiders(app.graph, fusionTarget, draggedId)
              app.selectedNodes.clear()
              app.selectedEdges.clear()
              notifySelectionChanged()
              callbacks?.onFusionApplied?.()
              callbacks?.onGraphChanged()
            }
          } else {
            // Not a valid fusion — bounce back (undo the move)
            app.history.undo(app.graph)
          }
        } else {
          // Check if dragged node overlaps any spider → bounce back
          if (state.nodeIds.length === 1) {
            const draggedNode = app.graph.nodes.get(state.nodeIds[0])
            if (draggedNode && draggedNode.type !== NodeType.Boundary) {
              const fusionRadius = SPIDER_RADIUS * 2.2
              for (const candidate of app.graph.nodes.values()) {
                if (candidate.id === draggedNode.id) continue
                if (candidate.type === NodeType.Boundary) continue
                const cdx = draggedNode.x - candidate.x
                const cdy = draggedNode.y - candidate.y
                const dist = Math.sqrt(cdx * cdx + cdy * cdy)
                if (dist < fusionRadius) {
                  // Overlapping another spider but not a valid fusion → bounce back
                  app.history.undo(app.graph)
                  break
                }
              }
            }
          }
        }

        rebuildSpatialIndex(app.graph)
        setCursor('')
        markDirty()
        break
      }

      case 'dragging_wire': {
        const targetId = app.wireTargetNode

        if (targetId) {
          const sourceNode = app.graph.nodes.get(state.sourceNodeId)
          const targetNode = app.graph.nodes.get(targetId)

          if (sourceNode && targetNode) {
            // Validate: boundary arity
            let valid = true
            if (sourceNode.type === NodeType.Boundary && targetId !== state.sourceNodeId) {
              if (degree(app.graph, state.sourceNodeId) >= 1) valid = false
            }
            if (targetNode.type === NodeType.Boundary && targetId !== state.sourceNodeId) {
              if (degree(app.graph, targetId) >= 1) valid = false
            }

            if (valid) {
              const edgeType = callbacks?.getPlacementEdgeType() ?? EdgeType.Simple
              app.history.save(app.graph, 'Add wire')
              addEdge(app.graph, state.sourceNodeId, targetId, edgeType)
              rebuildSpatialIndex(app.graph)
              callbacks?.onGraphChanged()
            }
          }
        } else if (!callbacks?.isEditingLocked?.()) {
          // Released on empty canvas → create a new node and connect
          const world = screenToWorld(camera, e.clientX, e.clientY)
          const nodeType = NodeType.Boundary
          const sourceNode = app.graph.nodes.get(state.sourceNodeId)
          if (sourceNode) {
            // Validate: source boundary arity
            let valid = true
            if (sourceNode.type === NodeType.Boundary && degree(app.graph, state.sourceNodeId) >= 1) {
              valid = false
            }
            if (valid) {
              const edgeType = callbacks?.getPlacementEdgeType() ?? EdgeType.Simple
              app.history.save(app.graph, 'Add node + wire')
              const newId = addNode(app.graph, nodeType, world.x, world.y)
              addEdge(app.graph, state.sourceNodeId, newId, edgeType)
              app.animations.animateNodeIn(newId)
              rebuildSpatialIndex(app.graph)
              callbacks?.onGraphChanged()
            }
          }
        }

        // Clear wire state
        app.wireSourceNode = null
        app.wireTargetNode = null
        app.wireCursorWorld = null
        clearInteractionCanvas()
        setCursor('')
        markDirty()
        break
      }

      case 'pointing_canvas': {
        // Click on empty canvas → check for double-click
        const now = performance.now()
        const dx = e.clientX - lastClickX
        const dy = e.clientY - lastClickY
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (now - lastClickTime < DOUBLE_CLICK_MS && dist < 10) {
          // Double-click → create node (blocked in proof mode)
          if (callbacks?.isEditingLocked?.()) {
            lastClickTime = 0
            break
          }
          const rawNodeType = callbacks?.getPlacementNodeType() ?? NodeType.Z
          // Hadamard tool places boundary nodes (same as Wire tool)
          const nodeType = rawNodeType === null ? NodeType.Boundary : rawNodeType
          if (nodeType !== null) {
            const world = screenToWorld(camera, e.clientX, e.clientY)
            const label = nodeType === NodeType.Z ? 'Add Z spider'
              : nodeType === NodeType.X ? 'Add X spider'
              : 'Add boundary'
            app.history.save(app.graph, label)
            const newId = addNode(app.graph, nodeType, world.x, world.y)
            app.animations.animateNodeIn(newId)
            rebuildSpatialIndex(app.graph)
            markDirty()
            callbacks?.onGraphChanged()
          }
          lastClickTime = 0 // Reset to avoid triple-click
        } else {
          // Single click → deselect all
          if (!e.shiftKey) {
            app.selectedNodes.clear()
            app.selectedEdges.clear()
            notifySelectionChanged()
            markDirty()
          }
          lastClickTime = now
          lastClickX = e.clientX
          lastClickY = e.clientY
        }
        break
      }

      case 'panning': {
        // Calculate release velocity for momentum
        computeReleaseVelocity()
        setCursor('')
        break
      }

      case 'selection_box': {
        // Select all nodes in the box
        const ids = nodesInRect(
          app.graph,
          state.startWX, state.startWY,
          state.currentWX, state.currentWY,
        )
        if (!e.shiftKey) {
          app.selectedNodes.clear()
          app.selectedEdges.clear()
        }
        for (const id of ids) {
          app.selectedNodes.add(id)
        }
        notifySelectionChanged()
        clearInteractionCanvas()
        markDirty()
        break
      }

    }

    state = { type: 'idle' }
  }

  // --- Keyboard events ---

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (callbacks?.isEditingLocked?.()) return
      if (app.selectedNodes.size === 0 && app.selectedEdges.size === 0) return
      // Prevent browser back navigation on Backspace
      e.preventDefault()

      app.history.save(app.graph, 'Delete')

      // Delete selected edges first
      for (const edgeId of app.selectedEdges) {
        removeEdge(app.graph, edgeId)
      }
      app.selectedEdges.clear()
      notifySelectionChanged()

      // Capture ghost data before deleting nodes (for fade-out animation)
      for (const nodeId of app.selectedNodes) {
        const node = app.graph.nodes.get(nodeId)
        if (node) {
          app.animations.animateNodeOut({
            id: node.id, x: node.x, y: node.y,
            type: node.type, phaseLabel: phaseToString(node.phase),
            anim: null!,  // filled by animateNodeOut
          })
        }
      }

      // Delete selected nodes (also removes their edges)
      for (const nodeId of app.selectedNodes) {
        removeNode(app.graph, nodeId)
      }
      app.selectedNodes.clear()

      rebuildSpatialIndex(app.graph)
      markDirty()
      callbacks?.onGraphChanged()
    }

    // Undo: Ctrl+Z / Cmd+Z
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      if (callbacks?.onProofUndo?.()) return
      app.history.undo(app.graph)
      app.selectedNodes.clear()
      app.selectedEdges.clear()
      notifySelectionChanged()
      rebuildSpatialIndex(app.graph)
      markDirty()
      callbacks?.onGraphChanged()
    }

    // Redo: Ctrl+Shift+Z / Cmd+Shift+Z
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
      e.preventDefault()
      if (callbacks?.onProofRedo?.()) return
      app.history.redo(app.graph)
      app.selectedNodes.clear()
      app.selectedEdges.clear()
      notifySelectionChanged()
      rebuildSpatialIndex(app.graph)
      markDirty()
      callbacks?.onGraphChanged()
    }

    // Skip single-key shortcuts if a modifier is held (except Cmd+A/C/V/X/D)
    if (e.ctrlKey || e.metaKey) {
      // Select All: Cmd+A / Ctrl+A
      if (e.key === 'a') {
        e.preventDefault()
        for (const id of app.graph.nodes.keys()) app.selectedNodes.add(id)
        for (const id of app.graph.edges.keys()) app.selectedEdges.add(id)
        notifySelectionChanged()
        markDirty()
      }

      // Copy: Cmd+C / Ctrl+C
      if (e.key === 'c' && !e.shiftKey) {
        if (app.selectedNodes.size === 0) return
        e.preventDefault()
        const sub = extractSubgraph(app.graph, app.selectedNodes)
        app.clipboard = {
          nodes: sub.nodes,
          edges: sub.edges,
          centroidX: sub.centroidX,
          centroidY: sub.centroidY,
        }
      }

      // Paste: Cmd+V / Ctrl+V
      if (e.key === 'v' && !e.shiftKey) {
        if (!app.clipboard || app.clipboard.nodes.size === 0) return
        if (callbacks?.isEditingLocked?.()) return
        e.preventDefault()
        app.history.save(app.graph, 'Paste')
        const { newNodeIds, newEdgeIds } = mergeSubgraph(
          app.graph,
          app.clipboard.nodes,
          app.clipboard.edges,
          app.clipboard.centroidX,
          app.clipboard.centroidY,
          app.clipboard.centroidX + 40,
          app.clipboard.centroidY + 40,
        )
        app.selectedNodes.clear()
        app.selectedEdges.clear()
        for (const id of newNodeIds) app.selectedNodes.add(id)
        for (const id of newEdgeIds) app.selectedEdges.add(id)
        rebuildSpatialIndex(app.graph)
        notifySelectionChanged()
        markDirty()
        callbacks?.onGraphChanged()
      }

      // Cut: Cmd+X / Ctrl+X
      if (e.key === 'x' && !e.shiftKey) {
        if (app.selectedNodes.size === 0) return
        if (callbacks?.isEditingLocked?.()) return
        e.preventDefault()
        // Copy first
        const sub = extractSubgraph(app.graph, app.selectedNodes)
        app.clipboard = {
          nodes: sub.nodes,
          edges: sub.edges,
          centroidX: sub.centroidX,
          centroidY: sub.centroidY,
        }
        // Then delete
        app.history.save(app.graph, 'Cut')
        for (const edgeId of app.selectedEdges) removeEdge(app.graph, edgeId)
        for (const nodeId of app.selectedNodes) removeNode(app.graph, nodeId)
        app.selectedNodes.clear()
        app.selectedEdges.clear()
        rebuildSpatialIndex(app.graph)
        notifySelectionChanged()
        markDirty()
        callbacks?.onGraphChanged()
      }

      // Duplicate: Cmd+D / Ctrl+D
      if (e.key === 'd') {
        if (app.selectedNodes.size === 0) return
        if (callbacks?.isEditingLocked?.()) return
        e.preventDefault()
        const sub = extractSubgraph(app.graph, app.selectedNodes)
        app.history.save(app.graph, 'Duplicate')
        const { newNodeIds, newEdgeIds } = mergeSubgraph(
          app.graph,
          sub.nodes,
          sub.edges,
          sub.centroidX,
          sub.centroidY,
          sub.centroidX + 40,
          sub.centroidY + 40,
        )
        app.selectedNodes.clear()
        app.selectedEdges.clear()
        for (const id of newNodeIds) app.selectedNodes.add(id)
        for (const id of newEdgeIds) app.selectedEdges.add(id)
        rebuildSpatialIndex(app.graph)
        notifySelectionChanged()
        markDirty()
        callbacks?.onGraphChanged()
      }

      return
    }
    if (e.altKey) return

    // C: Toggle color of selected spiders (Z↔X)
    if (e.key === 'c' || e.key === 'C') {
      if (callbacks?.isEditingLocked?.()) return
      if (app.selectedNodes.size === 0) return
      const spiders: string[] = []
      for (const id of app.selectedNodes) {
        const node = app.graph.nodes.get(id)
        if (node && (node.type === NodeType.Z || node.type === NodeType.X)) {
          spiders.push(id)
        }
      }
      if (spiders.length === 0) return
      app.history.save(app.graph, 'Toggle Color')
      for (const id of spiders) {
        const node = app.graph.nodes.get(id)!
        setNodeType(app.graph, id, node.type === NodeType.Z ? NodeType.X : NodeType.Z)
      }
      markDirty()
      callbacks?.onGraphChanged()
    }

    // H: Toggle Hadamard/Simple on selected edges
    if (e.key === 'h' || e.key === 'H') {
      if (callbacks?.isEditingLocked?.()) return
      if (app.selectedEdges.size === 0) return
      app.history.save(app.graph, 'Toggle Hadamard')
      for (const id of app.selectedEdges) {
        const edge = app.graph.edges.get(id)
        if (edge) {
          const newType = edge.type === EdgeType.Hadamard ? EdgeType.Simple : EdgeType.Hadamard
          app.graph.edges.set(id, { ...edge, type: newType })
        }
      }
      markDirty()
      callbacks?.onGraphChanged()
    }

    // 1-4: Switch palette tool
    if (e.key >= '1' && e.key <= '4') {
      callbacks?.setPaletteTool?.(parseInt(e.key))
    }

    // Escape: cancel unfuse partition, or deselect all + dismiss context menu
    if (e.key === 'Escape') {
      if (callbacks?.isUnfusePartitionActive?.()) {
        callbacks.onUnfuseCancel?.()
        return
      }
      callbacks?.dismissContextMenu()
      if (app.selectedNodes.size > 0 || app.selectedEdges.size > 0) {
        app.selectedNodes.clear()
        app.selectedEdges.clear()
        notifySelectionChanged()
        markDirty()
      }
    }

    // ?: Toggle keyboard shortcuts overlay
    if (e.key === '?') {
      callbacks?.toggleShortcutsOverlay?.()
    }
  }

  // --- Wheel (zoom) ---

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    const zoomFactor = Math.pow(2, -e.deltaY / 500)
    zoomAt(camera, e.clientX, e.clientY, zoomFactor)
    markDirty()
  }

  function onContextMenu(e: MouseEvent) {
    e.preventDefault()
    if (!callbacks) return

    const world = screenToWorld(camera, e.clientX, e.clientY)
    const hit = hitTest(app.graph, world.x, world.y, camera.zoom)
    // Note: contextmenu from touch is handled by long-press, not this handler

    if (callbacks.isEditingLocked?.()) {
      // Proof mode: only allow context menu on nodes (for color change)
      if (hit?.type === 'node') {
        callbacks.showContextMenuForNode(hit.nodeId)
      } else {
        callbacks.dismissContextMenu()
      }
      return
    }

    if (hit?.type === 'node') {
      callbacks.showContextMenuForNode(hit.nodeId)
    } else if (hit?.type === 'edge') {
      callbacks.showContextMenuForEdge(hit.edgeId)
    } else {
      callbacks.dismissContextMenu()
    }
  }

  // --- Wire creation helpers ---

  /** Find nearest node within snap radius (world space). */
  function findNearestNode(wx: number, wy: number): string | null {
    let bestId: string | null = null
    let bestDist = WIRE_TARGET_RADIUS

    for (const node of app.graph.nodes.values()) {
      const dx = wx - node.x
      const dy = wy - node.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < bestDist) {
        bestDist = dist
        bestId = node.id
      }
    }

    return bestId
  }

  /** Draw the provisional wire on the interaction canvas. */
  function drawProvisionalWire() {
    if (state.type !== 'dragging_wire' || !app.wireCursorWorld) return

    const sourceNode = app.graph.nodes.get(state.sourceNodeId)
    if (!sourceNode) return

    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = canvas.clientHeight

    interactionCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    interactionCtx.clearRect(0, 0, width, height)

    // Convert world coords to screen coords
    const sx = (sourceNode.x - camera.x) * camera.zoom
    const sy = (sourceNode.y - camera.y) * camera.zoom

    let ex: number, ey: number
    if (app.wireTargetNode) {
      // Snap to target node center
      const targetNode = app.graph.nodes.get(app.wireTargetNode)
      if (targetNode) {
        ex = (targetNode.x - camera.x) * camera.zoom
        ey = (targetNode.y - camera.y) * camera.zoom
      } else {
        ex = (app.wireCursorWorld.x - camera.x) * camera.zoom
        ey = (app.wireCursorWorld.y - camera.y) * camera.zoom
      }
    } else {
      ex = (app.wireCursorWorld.x - camera.x) * camera.zoom
      ey = (app.wireCursorWorld.y - camera.y) * camera.zoom
    }

    // Bezier control point: slight rubber-band tension
    // Control point is pulled toward the midpoint with some lag
    const mx = (sx + ex) / 2
    const my = (sy + ey) / 2
    // Add a subtle perpendicular offset for visual interest
    const dx = ex - sx
    const dy = ey - sy
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const tension = Math.min(len * 0.15, 20)
    const cpx = mx - (dy / len) * tension * 0.3
    const cpy = my + (dx / len) * tension * 0.3

    // Draw provisional wire
    interactionCtx.beginPath()
    interactionCtx.moveTo(sx, sy)
    interactionCtx.quadraticCurveTo(cpx, cpy, ex, ey)
    interactionCtx.strokeStyle = app.wireTargetNode ? 'rgba(80, 140, 255, 0.8)' : 'rgba(100, 100, 100, 0.5)'
    interactionCtx.lineWidth = 2.5
    interactionCtx.setLineDash([6, 4])
    interactionCtx.stroke()
    interactionCtx.setLineDash([])

    // Draw source dot
    interactionCtx.beginPath()
    interactionCtx.arc(sx, sy, 4, 0, Math.PI * 2)
    interactionCtx.fillStyle = 'rgba(80, 140, 255, 0.7)'
    interactionCtx.fill()

    // Draw target snap indicator
    if (app.wireTargetNode) {
      interactionCtx.beginPath()
      interactionCtx.arc(ex, ey, 8, 0, Math.PI * 2)
      interactionCtx.strokeStyle = 'rgba(80, 140, 255, 0.6)'
      interactionCtx.lineWidth = 2
      interactionCtx.stroke()
    }
  }

  // --- Momentum helpers ---

  function resetVelocity() {
    velocity.x = 0
    velocity.y = 0
    recentDeltas.length = 0
    lastPointerTime = performance.now()
  }

  function trimDeltas() {
    let totalDt = 0
    let i = recentDeltas.length - 1
    while (i >= 0 && totalDt < 80) {
      totalDt += recentDeltas[i].dt
      i--
    }
    if (i >= 0) recentDeltas.splice(0, i + 1)
  }

  function computeReleaseVelocity() {
    if (recentDeltas.length > 0) {
      let totalDx = 0, totalDy = 0, totalDt = 0
      for (const d of recentDeltas) {
        totalDx += d.dx
        totalDy += d.dy
        totalDt += d.dt
      }
      if (totalDt > 0) {
        velocity.x = (totalDx / totalDt) * 1000
        velocity.y = (totalDy / totalDt) * 1000
      }
    }
  }

  // --- Selection box drawing ---

  function drawSelectionBox() {
    if (state.type !== 'selection_box') return
    const dpr = window.devicePixelRatio || 1
    const width = canvas.clientWidth
    const height = canvas.clientHeight

    interactionCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    interactionCtx.clearRect(0, 0, width, height)

    // Convert world coords to screen coords
    const x1 = (state.startWX - camera.x) * camera.zoom
    const y1 = (state.startWY - camera.y) * camera.zoom
    const x2 = (state.currentWX - camera.x) * camera.zoom
    const y2 = (state.currentWY - camera.y) * camera.zoom

    const rx = Math.min(x1, x2)
    const ry = Math.min(y1, y2)
    const rw = Math.abs(x2 - x1)
    const rh = Math.abs(y2 - y1)

    interactionCtx.fillStyle = 'rgba(80, 140, 255, 0.08)'
    interactionCtx.fillRect(rx, ry, rw, rh)
    interactionCtx.strokeStyle = 'rgba(80, 140, 255, 0.4)'
    interactionCtx.lineWidth = 1
    interactionCtx.setLineDash([4, 4])
    interactionCtx.strokeRect(rx, ry, rw, rh)
    interactionCtx.setLineDash([])
  }

  function clearInteractionCanvas() {
    const dpr = window.devicePixelRatio || 1
    interactionCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    interactionCtx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
  }

  // --- Haptic on touchend (before pointerup) ---
  // iOS only grants haptic user activation from click/touchend, not pointerup.
  // On drag-to-fuse, fusionTargetNode is already set by pointermove.
  // DEBUG: visible banner to trace touchend state
  const _dbg = document.createElement('div')
  _dbg.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:red;color:white;font:bold 16px sans-serif;padding:8px;text-align:center;pointer-events:none;opacity:0;transition:opacity 0.3s'
  document.body.appendChild(_dbg)
  function onTouchEnd() {
    _dbg.textContent = `TE: ${state.type} ft:${app.fusionTargetNode ?? 'null'}`
    _dbg.style.opacity = '1'
    setTimeout(() => { _dbg.style.opacity = '0' }, 2000)
    if (state.type === 'dragging_node' && app.fusionTargetNode) {
      hapticTap()
    }
  }

  // --- Attach listeners ---
  canvas.addEventListener('touchend', onTouchEnd, { passive: true })
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', (e) => {
    // Touch cleanup
    if (e.pointerType === 'touch') {
      activePointers.delete(e.pointerId)
      clearLongPress()
      if (activePointers.size < 2) pinchState = null
    }

    // Clean up wire/fusion state on cancel
    if (state.type === 'dragging_wire') {
      app.wireSourceNode = null
      app.wireTargetNode = null
      app.wireCursorWorld = null
      clearInteractionCanvas()
    }
    if (state.type === 'dragging_node') {
      app.fusionTargetNode = null
    }
    markDirty()
    state = { type: 'idle' }
  })
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('keydown', onKeyDown)

  /** Called each frame. Applies pan momentum. */
  function tick(dt: number) {
    if (state.type === 'panning') return

    const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y)
    if (speed < VELOCITY_THRESHOLD) {
      velocity.x = 0
      velocity.y = 0
      return
    }

    pan(camera, velocity.x * dt, velocity.y * dt)
    markDirty()
    velocity.x *= PAN_FRICTION
    velocity.y *= PAN_FRICTION
  }

  function destroy() {
    canvas.removeEventListener('touchend', onTouchEnd)
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
    canvas.removeEventListener('contextmenu', onContextMenu)
    window.removeEventListener('keydown', onKeyDown)
  }

  return { tick, destroy }
}
