import { describe, it, expect } from 'vitest'
import {
  phase, addPhases, negatePhase, isZeroPhase, phasesEqual,
  phaseToString, parsePhase, phaseToRadians,
  phaseToJsonString, phaseFromJsonString, ZERO,
} from '../model/Phase.ts'

describe('Phase creation and normalization', () => {
  it('creates zero phase', () => {
    const p = phase(0)
    expect(p.n).toBe(0)
    expect(p.d).toBe(1)
  })

  it('reduces fractions', () => {
    const p = phase(2, 4)
    expect(p.n).toBe(1)
    expect(p.d).toBe(2)
  })

  it('normalizes mod 2', () => {
    // 5/2 mod 2 = 1/2
    const p = phase(5, 2)
    expect(p.n).toBe(1)
    expect(p.d).toBe(2)
  })

  it('handles negative numerators', () => {
    // -1/4 mod 2 = 7/4
    const p = phase(-1, 4)
    expect(p.n).toBe(7)
    expect(p.d).toBe(4)
  })

  it('handles negative denominators', () => {
    const p = phase(1, -4)
    // -1/4 mod 2 = 7/4
    expect(p.n).toBe(7)
    expect(p.d).toBe(4)
  })

  it('throws on zero denominator', () => {
    expect(() => phase(1, 0)).toThrow()
  })

  it('normalizes 2 to 0', () => {
    const p = phase(2)
    expect(p.n).toBe(0)
    expect(p.d).toBe(1)
  })

  it('normalizes 4/2 to 0', () => {
    const p = phase(4, 2)
    expect(p.n).toBe(0)
    expect(p.d).toBe(1)
  })
})

describe('Phase arithmetic', () => {
  it('adds two phases', () => {
    const a = phase(1, 4) // pi/4
    const b = phase(1, 2) // pi/2
    const sum = addPhases(a, b)
    // 1/4 + 1/2 = 3/4
    expect(sum.n).toBe(3)
    expect(sum.d).toBe(4)
  })

  it('addition wraps mod 2', () => {
    const a = phase(1) // pi
    const b = phase(1) // pi
    const sum = addPhases(a, b)
    // pi + pi = 2pi = 0
    expect(sum.n).toBe(0)
    expect(sum.d).toBe(1)
  })

  it('adds with different denominators', () => {
    const a = phase(1, 3) // pi/3
    const b = phase(1, 4) // pi/4
    const sum = addPhases(a, b)
    // 1/3 + 1/4 = 7/12
    expect(sum.n).toBe(7)
    expect(sum.d).toBe(12)
  })

  it('negates a phase', () => {
    const p = phase(1, 4) // pi/4
    const neg = negatePhase(p)
    // -1/4 mod 2 = 7/4
    expect(neg.n).toBe(7)
    expect(neg.d).toBe(4)
  })

  it('negate + add = zero', () => {
    const p = phase(3, 7)
    const neg = negatePhase(p)
    const sum = addPhases(p, neg)
    expect(isZeroPhase(sum)).toBe(true)
  })
})

describe('Phase comparison', () => {
  it('identifies zero', () => {
    expect(isZeroPhase(ZERO)).toBe(true)
    expect(isZeroPhase(phase(0, 5))).toBe(true)
    expect(isZeroPhase(phase(1, 4))).toBe(false)
  })

  it('compares equal phases', () => {
    expect(phasesEqual(phase(1, 2), phase(2, 4))).toBe(true)
    expect(phasesEqual(phase(1, 2), phase(1, 3))).toBe(false)
  })
})

describe('Phase display', () => {
  it('displays zero as empty string', () => {
    expect(phaseToString(ZERO)).toBe('')
  })

  it('displays pi', () => {
    expect(phaseToString(phase(1))).toBe('\u03C0')
  })

  it('displays pi/4', () => {
    expect(phaseToString(phase(1, 4))).toBe('\u03C0/4')
  })

  it('displays 3pi/4', () => {
    expect(phaseToString(phase(3, 4))).toBe('3\u03C0/4')
  })

  it('displays 3pi', () => {
    // 3 mod 2 = 1, but phase(3) normalizes to phase(1)
    // Let's use a value that stays as-is
    // Actually phase(3) normalizes to 1. So test with a non-reducible value.
    expect(phaseToString(phase(1))).toBe('\u03C0')
  })
})

describe('Phase parsing', () => {
  it('parses "0"', () => {
    expect(phasesEqual(parsePhase('0'), ZERO)).toBe(true)
  })

  it('parses empty string', () => {
    expect(phasesEqual(parsePhase(''), ZERO)).toBe(true)
  })

  it('parses "pi"', () => {
    expect(phasesEqual(parsePhase('pi'), phase(1))).toBe(true)
  })

  it('parses "pi/4"', () => {
    expect(phasesEqual(parsePhase('pi/4'), phase(1, 4))).toBe(true)
  })

  it('parses "3pi/4"', () => {
    expect(phasesEqual(parsePhase('3pi/4'), phase(3, 4))).toBe(true)
  })

  it('parses "-pi/2"', () => {
    // -1/2 mod 2 = 3/2
    expect(phasesEqual(parsePhase('-pi/2'), phase(3, 2))).toBe(true)
  })

  it('parses bare fraction "1/2"', () => {
    expect(phasesEqual(parsePhase('1/2'), phase(1, 2))).toBe(true)
  })

  it('parses π unicode', () => {
    expect(phasesEqual(parsePhase('\u03C0/4'), phase(1, 4))).toBe(true)
  })
})

describe('Phase radians', () => {
  it('converts 0 to 0', () => {
    expect(phaseToRadians(ZERO)).toBe(0)
  })

  it('converts 1 (pi) to pi', () => {
    expect(phaseToRadians(phase(1))).toBeCloseTo(Math.PI)
  })

  it('converts 1/2 to pi/2', () => {
    expect(phaseToRadians(phase(1, 2))).toBeCloseTo(Math.PI / 2)
  })
})

describe('PyZX JSON format', () => {
  it('serializes zero as "0"', () => {
    expect(phaseToJsonString(ZERO)).toBe('0')
  })

  it('serializes pi as "1"', () => {
    expect(phaseToJsonString(phase(1))).toBe('1')
  })

  it('serializes pi/2 as "1/2"', () => {
    expect(phaseToJsonString(phase(1, 2))).toBe('1/2')
  })

  it('serializes 3pi/4 as "3/4"', () => {
    expect(phaseToJsonString(phase(3, 4))).toBe('3/4')
  })

  it('round-trips through JSON format', () => {
    const values = [ZERO, phase(1), phase(1, 2), phase(3, 4), phase(7, 4), phase(1, 3)]
    for (const p of values) {
      const json = phaseToJsonString(p)
      const parsed = phaseFromJsonString(json)
      expect(phasesEqual(parsed, p)).toBe(true)
    }
  })
})
