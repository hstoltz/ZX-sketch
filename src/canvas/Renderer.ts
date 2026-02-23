import type { CameraState } from './Camera.ts'
import { applyCameraTransform } from './Camera.ts'
import { drawGrid } from './Grid.ts'
import { drawEdges, drawNodes, drawGhostNodes, drawGhostEdges } from './elements.ts'
import type { AppState } from '../AppState.ts'
import { getCanvasTheme } from '../theme/ThemeManager.ts'

/**
 * Manages the render loop. Only redraws when the dirty flag is set.
 * Uses requestAnimationFrame for smooth animation.
 */
export function createRenderer(
  sceneCanvas: HTMLCanvasElement,
  sceneCtx: CanvasRenderingContext2D,
  camera: CameraState,
  app: AppState,
  onTick: (dt: number) => void,
): { markDirty: () => void; start: () => void; stop: () => void } {
  let dirty = true
  let running = false
  let animFrameId = 0
  let lastTime = 0
  let elapsedTime = 0

  function markDirty() {
    dirty = true
  }

  function render(now: number) {
    if (!running) return
    animFrameId = requestAnimationFrame(render)

    const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000
    lastTime = now
    elapsedTime += dt

    // Run per-frame logic (momentum, animations)
    onTick(dt)

    // Tick animations
    if (dt > 0) {
      const animActive = app.animations.tick(dt)
      if (animActive) dirty = true
    }

    // Keep redrawing while there's a selection (for pulse animation), wire creation, fusion, or animations
    if (app.selectedNodes.size > 0 || app.selectedEdges.size > 0 || app.wireSourceNode || app.fusionTargetNode || app.animations.hasActiveAnimations || app.rewriteHighlightNodes.size > 0) {
      dirty = true
    }

    if (!dirty) return
    dirty = false

    const dpr = window.devicePixelRatio || 1
    const width = sceneCanvas.clientWidth
    const height = sceneCanvas.clientHeight

    // --- Scene layer: grid + edges + nodes ---
    sceneCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
    sceneCtx.fillStyle = getCanvasTheme().bgColor
    sceneCtx.fillRect(0, 0, width, height)

    applyCameraTransform(sceneCtx, camera, dpr)

    // Cross-fade: apply globalAlpha to entire scene after background
    const crossFadeProgress = app.animations.getCrossFadeProgress()
    if (crossFadeProgress !== null) {
      sceneCtx.globalAlpha = Math.max(0, Math.min(1, crossFadeProgress))
    }

    drawGrid(sceneCtx, camera, width, height)

    // Selection pulse: gentle sine wave, 0..1
    const selectionPulse = (Math.sin(elapsedTime * Math.PI * 2) + 1) / 2

    // Draw edges first (underneath), then ghost edges, then ghost nodes, then nodes on top
    drawEdges(sceneCtx, app.graph, app.selectedEdges, app.hoveredEdge, app.animations, app.hoverWorld, app.proof !== null ? app.hopfCutEdges : null, app.unfusePartition)
    drawGhostEdges(sceneCtx, app.animations.ghostEdges)
    drawGhostNodes(sceneCtx, app.animations.ghosts)
    drawNodes(sceneCtx, app.graph, app.selectedNodes, app.hoveredNode, selectionPulse, app.wireTargetNode, app.fusionTargetNode, app.animations, app.rewriteHighlightNodes, app.proof !== null ? app.idRemovalNodes : null, app.hoverWorld)

    // Reset globalAlpha if cross-fade was active
    if (crossFadeProgress !== null) {
      sceneCtx.globalAlpha = 1
    }

    // Interaction layer is managed by InputHandler (selection box, provisional wires)
  }

  function start() {
    if (running) return
    running = true
    lastTime = 0
    animFrameId = requestAnimationFrame(render)
  }

  function stop() {
    running = false
    cancelAnimationFrame(animFrameId)
  }

  return { markDirty, start, stop }
}
