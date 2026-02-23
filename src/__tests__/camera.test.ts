import { describe, it, expect } from 'vitest'
import { createCamera, screenToWorld, worldToScreen, pan, zoomAt } from '../canvas/Camera.ts'

describe('Camera', () => {
  it('creates camera at origin with zoom 1', () => {
    const cam = createCamera()
    expect(cam.x).toBe(0)
    expect(cam.y).toBe(0)
    expect(cam.zoom).toBe(1)
  })

  it('screenToWorld is identity at default camera', () => {
    const cam = createCamera()
    const world = screenToWorld(cam, 100, 200)
    expect(world.x).toBe(100)
    expect(world.y).toBe(200)
  })

  it('worldToScreen is identity at default camera', () => {
    const cam = createCamera()
    const screen = worldToScreen(cam, 100, 200)
    expect(screen.x).toBe(100)
    expect(screen.y).toBe(200)
  })

  it('screenToWorld accounts for pan offset', () => {
    const cam = createCamera()
    cam.x = 50
    cam.y = 100
    const world = screenToWorld(cam, 0, 0)
    expect(world.x).toBe(50)
    expect(world.y).toBe(100)
  })

  it('screenToWorld accounts for zoom', () => {
    const cam = createCamera()
    cam.zoom = 2
    // At 2x zoom, screen pixel 100 maps to world pixel 50
    const world = screenToWorld(cam, 100, 200)
    expect(world.x).toBe(50)
    expect(world.y).toBe(100)
  })

  it('screenToWorld and worldToScreen are inverses', () => {
    const cam = createCamera()
    cam.x = 37
    cam.y = -42
    cam.zoom = 1.7

    const world = screenToWorld(cam, 150, 300)
    const screen = worldToScreen(cam, world.x, world.y)
    expect(screen.x).toBeCloseTo(150, 10)
    expect(screen.y).toBeCloseTo(300, 10)
  })

  it('pan moves camera by screen delta / zoom', () => {
    const cam = createCamera()
    cam.zoom = 2
    pan(cam, 100, 200)
    // Pan of 100 screen px at zoom 2 = 50 world px movement
    expect(cam.x).toBe(-50)
    expect(cam.y).toBe(-100)
  })

  it('zoomAt keeps world point under cursor fixed', () => {
    const cam = createCamera()
    cam.x = 10
    cam.y = 20

    const screenX = 200
    const screenY = 300

    // World point under cursor before zoom
    const before = screenToWorld(cam, screenX, screenY)

    zoomAt(cam, screenX, screenY, 1.5)

    // World point under cursor after zoom should be the same
    const after = screenToWorld(cam, screenX, screenY)
    expect(after.x).toBeCloseTo(before.x, 10)
    expect(after.y).toBeCloseTo(before.y, 10)
  })

  it('zoom clamps to min/max', () => {
    const cam = createCamera()

    // Zoom way in
    for (let i = 0; i < 100; i++) zoomAt(cam, 0, 0, 2)
    expect(cam.zoom).toBeLessThanOrEqual(10)

    // Zoom way out
    for (let i = 0; i < 200; i++) zoomAt(cam, 0, 0, 0.5)
    expect(cam.zoom).toBeGreaterThanOrEqual(0.1)
  })
})
