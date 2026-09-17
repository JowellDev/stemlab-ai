import { describe, expect, it } from 'vitest'
import { computePeaks, resamplePeaks, slicePeaks } from '../src/peaks.js'
import { FakeAudioBuffer, asAudioBuffer } from './fake-audio-context.js'

describe('resamplePeaks', () => {
  it('reduit a la largeur demandee', () => {
    const waveform = {
      pointsPerSecond: 512,
      peaks: Array.from({ length: 1000 }, (_, i) => i / 999),
    }
    expect(resamplePeaks(waveform, 100)).toHaveLength(100)
  })

  it('conserve le maximum de chaque fenetre, pas la moyenne', () => {
    // Une attaque isolee ne doit pas disparaitre au sous-echantillonnage.
    const waveform = { pointsPerSecond: 10, peaks: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0] }
    const resampled = resamplePeaks(waveform, 2)
    expect(resampled[0]).toBe(1)
    expect(resampled[1]).toBe(0)
  })

  it('rend un tableau vide pour une largeur nulle', () => {
    expect(resamplePeaks({ pointsPerSecond: 10, peaks: [1] }, 0)).toHaveLength(0)
  })

  it('supporte un agrandissement', () => {
    expect(resamplePeaks({ pointsPerSecond: 10, peaks: [0.5, 1] }, 8)).toHaveLength(8)
  })
})

describe('slicePeaks', () => {
  it('extrait la fenetre temporelle demandee', () => {
    const waveform = { pointsPerSecond: 10, peaks: Array.from({ length: 100 }, (_, i) => i / 99) }
    const sliced = slicePeaks(waveform, 2, 5)
    expect(sliced.pointsPerSecond).toBe(10)
    expect(sliced.peaks).toHaveLength(30)
  })
})

describe('computePeaks', () => {
  it('produit le nombre de points attendu', () => {
    const buffer = new FakeAudioBuffer(2, 44_100, 1)
    const waveform = computePeaks(asAudioBuffer(buffer), 512)
    expect(waveform.pointsPerSecond).toBe(512)
    // 2 s a 512 points/s, aux arrondis d'echantillonnage pres.
    expect(waveform.peaks.length).toBeGreaterThanOrEqual(1020)
    expect(waveform.peaks.length).toBeLessThanOrEqual(1030)
  })

  it('releve l amplitude crete absolue', () => {
    const buffer = new FakeAudioBuffer(1, 1000, 1)
    const data = buffer.getChannelData(0)
    data[0] = -0.75
    data[500] = 0.4
    const waveform = computePeaks(asAudioBuffer(buffer), 2)
    expect(waveform.peaks[0]).toBeCloseTo(0.75, 6)
    expect(waveform.peaks[1]).toBeCloseTo(0.4, 6)
  })
})
