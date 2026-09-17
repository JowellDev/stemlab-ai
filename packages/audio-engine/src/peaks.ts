import type { Waveform } from '@stemlab/contracts'

/**
 * Reduction des peaks pre-calcules a la largeur d'affichage.
 *
 * Les peaks arrivent du worker (512 points/seconde) : le client ne decode jamais
 * l'audio complet pour dessiner une forme d'onde. Il ne reste qu'a les sous-echantillonner
 * a la largeur reelle du canvas, en prenant le *maximum* de chaque fenetre — une
 * moyenne lisserait les transitoires et ferait disparaitre les attaques de batterie.
 */
export function resamplePeaks(waveform: Waveform, width: number): Float32Array {
  const output = new Float32Array(Math.max(0, Math.floor(width)))
  const { peaks } = waveform
  if (output.length === 0 || peaks.length === 0) return output

  const ratio = peaks.length / output.length

  for (let i = 0; i < output.length; i += 1) {
    const start = Math.floor(i * ratio)
    const end = Math.max(start + 1, Math.floor((i + 1) * ratio))
    let max = 0
    for (let j = start; j < end && j < peaks.length; j += 1) {
      const value = peaks[j] ?? 0
      if (value > max) max = value
    }
    output[i] = max
  }

  return output
}

/** Fenetre temporelle [start, end] des peaks, pour un affichage zoome. */
export function slicePeaks(waveform: Waveform, start: number, end: number): Waveform {
  const from = Math.max(0, Math.floor(start * waveform.pointsPerSecond))
  const to = Math.min(waveform.peaks.length, Math.ceil(end * waveform.pointsPerSecond))
  return { pointsPerSecond: waveform.pointsPerSecond, peaks: waveform.peaks.slice(from, to) }
}

/**
 * Calcule les peaks d'un AudioBuffer. Sert de repli et aux tests ; en production
 * c'est le worker qui les produit, dans le meme format.
 */
export function computePeaks(buffer: AudioBuffer, pointsPerSecond: number): Waveform {
  const samplesPerPoint = Math.max(1, Math.round(buffer.sampleRate / pointsPerSecond))
  const pointCount = Math.ceil(buffer.length / samplesPerPoint)
  const peaks = new Array<number>(pointCount).fill(0)

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let point = 0; point < pointCount; point += 1) {
      const start = point * samplesPerPoint
      const end = Math.min(start + samplesPerPoint, data.length)
      let max = peaks[point] ?? 0
      for (let i = start; i < end; i += 1) {
        const value = Math.abs(data[i] ?? 0)
        if (value > max) max = value
      }
      peaks[point] = max > 1 ? 1 : max
    }
  }

  return { pointsPerSecond, peaks }
}
