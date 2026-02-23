/** Camera state for the infinite canvas. Tracks pan offset and zoom level. */
export interface CameraState {
  /** World-space X offset (top-left corner of viewport in world coords) */
  x: number
  /** World-space Y offset (top-left corner of viewport in world coords) */
  y: number
  /** Zoom level. 1 = 100%. >1 = zoomed in, <1 = zoomed out */
  zoom: number
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 10

export function createCamera(): CameraState {
  return { x: 0, y: 0, zoom: 1 }
}

/** Convert screen (CSS pixel) coordinates to world coordinates. */
export function screenToWorld(camera: CameraState, screenX: number, screenY: number): { x: number; y: number } {
  return {
    x: screenX / camera.zoom + camera.x,
    y: screenY / camera.zoom + camera.y,
  }
}

/** Convert world coordinates to screen (CSS pixel) coordinates. */
export function worldToScreen(camera: CameraState, worldX: number, worldY: number): { x: number; y: number } {
  return {
    x: (worldX - camera.x) * camera.zoom,
    y: (worldY - camera.y) * camera.zoom,
  }
}

/** Pan the camera by a screen-space delta (e.g. from pointer movement). */
export function pan(camera: CameraState, screenDx: number, screenDy: number): void {
  camera.x -= screenDx / camera.zoom
  camera.y -= screenDy / camera.zoom
}

/**
 * Zoom toward a screen-space point (e.g. cursor position).
 * The world point under the cursor stays fixed.
 */
export function zoomAt(camera: CameraState, screenX: number, screenY: number, factor: number): void {
  // World point under the cursor before zoom
  const worldPoint = screenToWorld(camera, screenX, screenY)

  // Apply zoom with clamping
  camera.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor))

  // Adjust camera so the same world point stays under the cursor
  camera.x = worldPoint.x - screenX / camera.zoom
  camera.y = worldPoint.y - screenY / camera.zoom
}

/**
 * Center the camera so the given world-space bounding box is centered in the viewport.
 */
export function centerOnBounds(
  camera: CameraState,
  minX: number, minY: number, maxX: number, maxY: number,
  viewportWidth: number, viewportHeight: number,
): void {
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  camera.x = cx - viewportWidth / (2 * camera.zoom)
  camera.y = cy - viewportHeight / (2 * camera.zoom)
}

/**
 * Apply the camera transform to a Canvas 2D context.
 * Call this at the start of each frame before drawing world-space content.
 * The dpr (devicePixelRatio) scaling is composed in.
 */
export function applyCameraTransform(ctx: CanvasRenderingContext2D, camera: CameraState, dpr: number): void {
  const z = camera.zoom * dpr
  ctx.setTransform(z, 0, 0, z, -camera.x * z, -camera.y * z)
}
