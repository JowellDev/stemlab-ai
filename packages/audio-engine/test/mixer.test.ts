import { describe, expect, it } from 'vitest'
import { anySoloed, clampVolume, resolveGain, resolveGains } from '../src/mixer.js'
import type { StemMixState } from '../src/types.js'

const stem = (overrides: Partial<StemMixState> & Pick<StemMixState, 'type'>): StemMixState => ({
  volume: 1,
  muted: false,
  soloed: false,
  ...overrides,
})

describe('resolveGain', () => {
  it('rend le volume tel quel quand rien n est coupe ni en solo', () => {
    expect(resolveGain(stem({ type: 'vocals', volume: 0.6 }), false)).toBe(0.6)
  })

  it('coupe une piste mutee', () => {
    expect(resolveGain(stem({ type: 'vocals', muted: true }), false)).toBe(0)
  })

  it('coupe les pistes non solo des qu une piste est en solo', () => {
    expect(resolveGain(stem({ type: 'bass' }), true)).toBe(0)
  })

  it('laisse passer la piste en solo', () => {
    expect(resolveGain(stem({ type: 'bass', soloed: true, volume: 0.8 }), true)).toBe(0.8)
  })

  it('garde une piste en solo muette si elle est aussi coupee', () => {
    expect(resolveGain(stem({ type: 'bass', soloed: true, muted: true }), true)).toBe(0)
  })
})

describe('resolveGains', () => {
  it('applique le solo a l echelle du mix', () => {
    const gains = resolveGains([
      stem({ type: 'vocals', soloed: true, volume: 0.9 }),
      stem({ type: 'drums', volume: 1 }),
      stem({ type: 'bass', volume: 0.5 }),
    ])
    expect(gains.get('vocals')).toBe(0.9)
    expect(gains.get('drums')).toBe(0)
    expect(gains.get('bass')).toBe(0)
  })

  it('n applique aucune regle de solo quand aucune piste n est en solo', () => {
    const gains = resolveGains([
      stem({ type: 'vocals', volume: 0.9 }),
      stem({ type: 'drums', volume: 0.4 }),
    ])
    expect(gains.get('vocals')).toBe(0.9)
    expect(gains.get('drums')).toBe(0.4)
  })
})

describe('anySoloed', () => {
  it('detecte au moins une piste en solo', () => {
    expect(anySoloed([stem({ type: 'vocals' })])).toBe(false)
    expect(anySoloed([stem({ type: 'vocals' }), stem({ type: 'bass', soloed: true })])).toBe(true)
  })
})

describe('clampVolume', () => {
  it.each([
    [-1, 0],
    [0, 0],
    [0.5, 0.5],
    [1, 1],
    [2, 1],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
  ])('borne %s a %s', (input, expected) => {
    expect(clampVolume(input)).toBe(expected)
  })
})
