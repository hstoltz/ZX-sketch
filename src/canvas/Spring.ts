/**
 * Damped harmonic oscillator spring.
 * acceleration = -stiffness * displacement - damping * velocity
 */
export interface Spring {
  /** Current value */
  value: number
  /** Target value */
  target: number
  /** Current velocity */
  velocity: number
}

/** Create a spring at rest at a given value. */
export function createSpring(value: number, target?: number): Spring {
  return { value, target: target ?? value, velocity: 0 }
}

/** Spring presets — tuned for different animation feels. */
export const SPRING_PRESETS = {
  /** Quick snap — for connection snaps, small UI transitions */
  snappy: { stiffness: 600, damping: 35 },
  /** Medium bounce — for node placement, slight overshoot */
  bouncy: { stiffness: 300, damping: 18 },
  /** Gentle ease — for zoom smoothing */
  gentle: { stiffness: 150, damping: 20 },
  /** Fast decay — for deletion fade-out */
  fast: { stiffness: 800, damping: 40 },
} as const

const EPSILON = 0.001  // threshold to consider spring at rest

/**
 * Step a spring forward by dt seconds.
 * Returns true if the spring is still moving, false if at rest.
 */
export function stepSpring(
  spring: Spring,
  stiffness: number,
  damping: number,
  dt: number,
): boolean {
  // Clamp dt to avoid explosion on tab-switch
  const cdt = Math.min(dt, 1 / 30)

  const displacement = spring.value - spring.target
  const acceleration = -stiffness * displacement - damping * spring.velocity

  spring.velocity += acceleration * cdt
  spring.value += spring.velocity * cdt

  // Check if at rest
  if (Math.abs(displacement) < EPSILON && Math.abs(spring.velocity) < EPSILON) {
    spring.value = spring.target
    spring.velocity = 0
    return false
  }

  return true
}
