import { describe, it, expect } from 'vitest'
import { createSpring, stepSpring, SPRING_PRESETS } from '../canvas/Spring.ts'

describe('Spring physics', () => {
  it('should settle at target value', () => {
    const spring = createSpring(0, 1)
    const { stiffness, damping } = SPRING_PRESETS.snappy

    // Step for 2 seconds (should be well settled)
    for (let i = 0; i < 120; i++) {
      stepSpring(spring, stiffness, damping, 1 / 60)
    }

    expect(spring.value).toBeCloseTo(1, 2)
    expect(spring.velocity).toBeCloseTo(0, 2)
  })

  it('should return false when at rest', () => {
    const spring = createSpring(1, 1)
    const active = stepSpring(spring, 300, 20, 1 / 60)
    expect(active).toBe(false)
  })

  it('should return true while moving', () => {
    const spring = createSpring(0, 1)
    const active = stepSpring(spring, 300, 20, 1 / 60)
    expect(active).toBe(true)
  })

  it('bouncy spring should overshoot', () => {
    const spring = createSpring(0, 1)
    const { stiffness, damping } = SPRING_PRESETS.bouncy
    let maxValue = 0

    for (let i = 0; i < 60; i++) {
      stepSpring(spring, stiffness, damping, 1 / 60)
      if (spring.value > maxValue) maxValue = spring.value
    }

    // Should overshoot past 1.0
    expect(maxValue).toBeGreaterThan(1.0)
    // But eventually settle at 1.0
    for (let i = 0; i < 120; i++) {
      stepSpring(spring, stiffness, damping, 1 / 60)
    }
    expect(spring.value).toBeCloseTo(1, 2)
  })

  it('should handle large dt gracefully (clamped)', () => {
    const spring = createSpring(0, 1)
    // Simulate tab switch: dt = 5 seconds (clamped to 1/30)
    stepSpring(spring, 300, 20, 5)
    // Should not explode
    expect(Math.abs(spring.value)).toBeLessThan(100)
  })

  it('should animate from 1 to 0 (shrink)', () => {
    const spring = createSpring(1, 0)
    const { stiffness, damping } = SPRING_PRESETS.fast

    for (let i = 0; i < 120; i++) {
      stepSpring(spring, stiffness, damping, 1 / 60)
    }

    expect(spring.value).toBeCloseTo(0, 2)
  })
})
