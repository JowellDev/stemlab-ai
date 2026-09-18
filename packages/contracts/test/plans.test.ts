import { describe, expect, it } from 'vitest'
import { PLAN_LIMITS, allowsModel, limitsFor, monthReset, monthStart } from '../src/plans.js'

describe('plans', () => {
  it('limite le plan gratuit a cinq morceaux et quatre pistes', () => {
    const free = limitsFor('free')
    expect(free.tracksPerMonth).toBe(5)
    expect(free.maxStems).toBe(4)
  })

  it('ne borne pas le plan paye', () => {
    expect(limitsFor('pro').tracksPerMonth).toBeNull()
    expect(limitsFor('pro').maxStems).toBe(6)
  })

  it('reserve la separation en six pistes au plan paye', () => {
    expect(allowsModel('free', 'htdemucs')).toBe(true)
    expect(allowsModel('free', 'htdemucs_6s')).toBe(false)
    expect(allowsModel('pro', 'htdemucs_6s')).toBe(true)
  })

  it('annonce autant de pistes que le meilleur modele autorise en produit', () => {
    for (const [plan, limits] of Object.entries(PLAN_LIMITS)) {
      const attendu = limits.models.includes('htdemucs_6s') ? 6 : 4
      expect(limits.maxStems, plan).toBe(attendu)
    }
  })
})

describe('fenetre mensuelle', () => {
  it('borne le mois calendaire en UTC', () => {
    const now = new Date('2026-03-17T22:45:00Z')
    expect(monthStart(now).toISOString()).toBe('2026-03-01T00:00:00.000Z')
    expect(monthReset(now).toISOString()).toBe('2026-04-01T00:00:00.000Z')
  })

  it('passe a l annee suivante en decembre', () => {
    const now = new Date('2026-12-31T23:59:59Z')
    expect(monthReset(now).toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('ne depend pas du fuseau du serveur', () => {
    // Un instant qui tombe le mois precedent en heure locale negative.
    const now = new Date('2026-05-01T00:30:00Z')
    expect(monthStart(now).toISOString()).toBe('2026-05-01T00:00:00.000Z')
  })
})
