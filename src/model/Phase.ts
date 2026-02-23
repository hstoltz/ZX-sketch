import type { Phase } from './types.ts'

/** Greatest common divisor (always positive). */
function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b) {
    const t = b
    b = a % b
    a = t
  }
  return a
}

/** Create a normalized phase (reduced fraction, in [0, 2) as fraction of pi). */
export function phase(n: number, d: number = 1): Phase {
  if (d === 0) throw new Error('Phase denominator cannot be zero')
  // Ensure positive denominator
  if (d < 0) {
    n = -n
    d = -d
  }
  // Reduce
  const g = gcd(Math.abs(n), d)
  n = n / g
  d = d / g
  // Normalize to [0, 2): n/d mod 2 = (n mod 2d) / d
  n = ((n % (2 * d)) + 2 * d) % (2 * d)
  return { n, d }
}

/** The zero phase. */
export const ZERO: Phase = phase(0)

/** Add two phases (mod 2pi, i.e. mod 2 as fractions of pi). */
export function addPhases(a: Phase, b: Phase): Phase {
  // a.n/a.d + b.n/b.d = (a.n*b.d + b.n*a.d) / (a.d*b.d)
  return phase(a.n * b.d + b.n * a.d, a.d * b.d)
}

/** Negate a phase (mod 2). */
export function negatePhase(p: Phase): Phase {
  return phase(-p.n, p.d)
}

/** Check if a phase is zero. */
export function isZeroPhase(p: Phase): boolean {
  return p.n === 0
}

/** Check if two phases are equal. Both must be normalized. */
export function phasesEqual(a: Phase, b: Phase): boolean {
  return a.n === b.n && a.d === b.d
}

/** Convert phase to a display string. E.g. "pi/4", "pi", "3pi/2", "" for 0. */
export function phaseToString(p: Phase): string {
  if (p.n === 0) return ''
  if (p.d === 1) {
    if (p.n === 1) return '\u03C0'          // pi
    return `${p.n}\u03C0`                    // Npi
  }
  if (p.n === 1) return `\u03C0/${p.d}`      // pi/D
  return `${p.n}\u03C0/${p.d}`               // N*pi/D
}

/**
 * Parse a phase string into a Phase.
 * Accepts formats: "0", "1", "1/2", "3/4", "pi", "pi/4", "3pi/4",
 * "3*pi/4", "-pi/2", etc. Values are fractions of pi.
 */
export function parsePhase(s: string): Phase {
  s = s.trim()
  if (s === '' || s === '0') return ZERO

  // Remove optional "pi" or "π" — everything is in units of pi
  const hasPi = /pi|\u03C0/.test(s)
  let cleaned = s.replace(/\s*\*?\s*(pi|\u03C0)\s*/g, '')

  // If the string was just "pi" or "π", the coefficient is 1
  if (cleaned === '' || cleaned === '+') cleaned = '1'
  if (cleaned === '-') cleaned = '-1'

  // Handle fraction N/D
  if (cleaned.includes('/')) {
    const parts = cleaned.split('/')
    if (parts.length !== 2) throw new Error(`Invalid phase: "${s}"`)
    let numStr = parts[0].trim()
    // If numerator is empty or just a sign, it's implicit 1 (e.g. "pi/4" → "/4", "-pi/4" → "-/4")
    if (numStr === '' || numStr === '+') numStr = '1'
    if (numStr === '-') numStr = '-1'
    const num = parseInt(numStr, 10)
    const den = parseInt(parts[1], 10)
    if (isNaN(num) || isNaN(den) || den === 0) throw new Error(`Invalid phase: "${s}"`)
    return phase(num, den)
  }

  // Plain integer
  const num = parseInt(cleaned, 10)
  if (isNaN(num)) throw new Error(`Invalid phase: "${s}"`)

  if (hasPi) {
    // "3pi" → 3 (as fraction of pi)
    return phase(num)
  }
  // Bare number: treat as fraction of pi (PyZX convention)
  return phase(num)
}

/** Convert phase to radians (for rendering, e.g. the phase dial). */
export function phaseToRadians(p: Phase): number {
  return (p.n / p.d) * Math.PI
}

/**
 * Convert phase to PyZX JSON string format.
 * PyZX uses "N/D" where the value is a fraction of pi.
 * "0" for zero, "1" for pi, "1/2" for pi/2, etc.
 */
export function phaseToJsonString(p: Phase): string {
  if (p.n === 0) return '0'
  if (p.d === 1) return `${p.n}`
  return `${p.n}/${p.d}`
}

/**
 * Parse a PyZX JSON phase string.
 * Format: "0", "1", "1/2", "3/4", "π/4", "3π/2", etc.
 * PyZX may include the Unicode π character — strip it since
 * all values are already fractions of π.
 */
export function phaseFromJsonString(s: string): Phase {
  if (!s || s === '0') return ZERO
  // Strip π character — PyZX sometimes includes it (e.g. "π/4" instead of "1/4")
  let cleaned = s.replace(/\u03c0/g, '')
  // "π/4" → "/4" → numerator is 1; "π" → "" → value is 1
  if (cleaned === '' || cleaned === '+') cleaned = '1'
  if (cleaned === '-') cleaned = '-1'
  if (cleaned.includes('/')) {
    const parts = cleaned.split('/')
    let num = parts[0].trim()
    if (num === '' || num === '+') num = '1'
    if (num === '-') num = '-1'
    return phase(parseInt(num, 10), parseInt(parts[1], 10))
  }
  return phase(parseInt(cleaned, 10))
}
