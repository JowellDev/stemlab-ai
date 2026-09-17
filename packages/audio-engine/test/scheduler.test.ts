import { describe, expect, it } from 'vitest'
import { DEFAULT_LOOKAHEAD_SECONDS, planStart, type SchedulableStem } from '../src/scheduler.js'

const STEMS: SchedulableStem[] = [
  { type: 'vocals', duration: 180 },
  { type: 'drums', duration: 180 },
  { type: 'bass', duration: 180 },
  { type: 'other', duration: 180 },
]

describe('planStart', () => {
  it('planifie toutes les pistes sur un unique instant de demarrage', () => {
    const plan = planStart({ stems: STEMS, contextTime: 12.345, position: 0, duration: 180 })

    expect(plan.sources).toHaveLength(4)
    const instants = new Set(plan.sources.map((source) => source.when))
    expect(instants.size).toBe(1)
    expect(plan.when).toBeCloseTo(12.345 + DEFAULT_LOOKAHEAD_SECONDS, 12)
  })

  it('donne le meme offset a toutes les pistes', () => {
    const plan = planStart({ stems: STEMS, contextTime: 0, position: 42.5, duration: 180 })
    expect(new Set(plan.sources.map((source) => source.offset))).toEqual(new Set([42.5]))
  })

  it('respecte un lookahead explicite', () => {
    const plan = planStart({
      stems: STEMS,
      contextTime: 5,
      position: 0,
      duration: 180,
      lookahead: 0.25,
    })
    expect(plan.when).toBeCloseTo(5.25, 12)
  })

  it('omet une piste plus courte que la position demandee', () => {
    const plan = planStart({
      stems: [...STEMS, { type: 'piano', duration: 30 }],
      contextTime: 0,
      position: 45,
      duration: 180,
    })
    expect(plan.sources.map((source) => source.type)).not.toContain('piano')
    expect(plan.sources).toHaveLength(4)
  })

  it('ne planifie rien quand la position est en fin de morceau', () => {
    expect(
      planStart({ stems: STEMS, contextTime: 0, position: 180, duration: 180 }).sources,
    ).toEqual([])
  })

  it('borne une position hors bornes', () => {
    expect(planStart({ stems: STEMS, contextTime: 0, position: -10, duration: 180 }).position).toBe(
      0,
    )
    expect(planStart({ stems: STEMS, contextTime: 0, position: 999, duration: 180 }).position).toBe(
      180,
    )
  })

  it('traite une position non finie comme le debut du morceau', () => {
    expect(
      planStart({ stems: STEMS, contextTime: 0, position: Number.NaN, duration: 180 }).position,
    ).toBe(0)
  })
})
