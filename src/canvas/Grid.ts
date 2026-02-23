import type { CameraState } from './Camera.ts'
import { getCanvasTheme } from '../theme/ThemeManager.ts'

/** Base spacing between grid dots in world-space pixels. */
const BASE_SPACING = 40

/**
 * Draw the dot grid background.
 * Dots are evenly spaced in world space and fade/scale with zoom.
 * Only draws dots visible in the current viewport.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  camera: CameraState,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const zoom = camera.zoom
  const spacing = BASE_SPACING

  // Screen-space size of each dot — scales with zoom but stays subtle
  const dotRadius = Math.max(0.8, Math.min(2.0, zoom * 1.2))

  // Fade dots when very zoomed out (too dense) or very zoomed in (too sparse)
  let alpha = 1.0
  if (zoom < 0.3) {
    alpha = Math.max(0, (zoom - 0.1) / 0.2)
  } else if (zoom > 6) {
    alpha = Math.max(0.2, 1.0 - (zoom - 6) / 8)
  }

  if (alpha <= 0) return

  // Compute the world-space bounds of the viewport
  const worldLeft = camera.x
  const worldTop = camera.y
  const worldRight = camera.x + viewportWidth / zoom
  const worldBottom = camera.y + viewportHeight / zoom

  // Snap to grid lines to find first/last visible dots
  const startX = Math.floor(worldLeft / spacing) * spacing
  const startY = Math.floor(worldTop / spacing) * spacing
  const endX = Math.ceil(worldRight / spacing) * spacing
  const endY = Math.ceil(worldBottom / spacing) * spacing

  // Draw all visible dots. We work in world coordinates (camera transform is already applied).
  ctx.fillStyle = getCanvasTheme().gridDotColor
  ctx.globalAlpha = alpha

  for (let wy = startY; wy <= endY; wy += spacing) {
    for (let wx = startX; wx <= endX; wx += spacing) {
      ctx.beginPath()
      ctx.arc(wx, wy, dotRadius / zoom, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  ctx.globalAlpha = 1.0
}
