import { describe, expect, it } from 'vitest'
import {
  IDLE_CLOCK,
  contextTimeFor,
  hasEnded,
  pausedClock,
  positionAt,
  startedClock,
} from '../src/transport-clock.js'

const DURATION = 120

describe('positionAt', () => {
  it('reste a zero quand le transport est a l arret', () => {
    expect(positionAt(IDLE_CLOCK, 42, DURATION)).toBe(0)
  })

  it('rend la position figee quand le transport est en pause', () => {
    expect(positionAt(pausedClock(30), 999, DURATION)).toBe(30)
  })

  it('ne bouge pas pendant la fenetre de lookahead', () => {
    // Demarrage planifie a t=10 : a t=9.95, aucun son n'est encore sorti.
    const clock = startedClock(10, 5)
    expect(positionAt(clock, 9.95, DURATION)).toBe(5)
    expect(positionAt(clock, 10, DURATION)).toBe(5)
  })

  it('avance avec l horloge du contexte une fois le demarrage passe', () => {
    const clock = startedClock(10, 5)
    expect(positionAt(clock, 13, DURATION)).toBeCloseTo(8, 10)
  })

  it('tient compte du facteur de vitesse', () => {
    const clock = startedClock(0, 0, 0.75)
    expect(positionAt(clock, 4, DURATION)).toBeCloseTo(3, 10)
  })

  it('borne la position a la duree du morceau', () => {
    expect(positionAt(startedClock(0, 0), 10_000, DURATION)).toBe(DURATION)
  })

  it('borne une position negative a zero', () => {
    expect(positionAt(pausedClock(-5), 0, DURATION)).toBe(0)
  })
})

describe('hasEnded', () => {
  it('est faux a l arret', () => {
    expect(hasEnded(pausedClock(DURATION), 0, DURATION)).toBe(false)
  })

  it('devient vrai quand la position atteint la duree', () => {
    const clock = startedClock(0, 0)
    expect(hasEnded(clock, DURATION - 1, DURATION)).toBe(false)
    expect(hasEnded(clock, DURATION, DURATION)).toBe(true)
  })
})

describe('contextTimeFor', () => {
  it('rend null a l arret', () => {
    expect(contextTimeFor(pausedClock(10), 20)).toBeNull()
  })

  it('rend null pour une position deja passee', () => {
    expect(contextTimeFor(startedClock(10, 30), 20)).toBeNull()
  })

  it('convertit une position en instant du contexte', () => {
    expect(contextTimeFor(startedClock(10, 30), 40)).toBeCloseTo(20, 10)
  })

  it('tient compte du facteur de vitesse', () => {
    expect(contextTimeFor(startedClock(0, 0, 0.5), 10)).toBeCloseTo(20, 10)
  })
})
