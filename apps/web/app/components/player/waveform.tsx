import { resamplePeaks } from '@stemlab/audio-engine'
import type { StemType, Waveform as WaveformData } from '@stemlab/contracts'
import { useEffect, useRef } from 'react'
import { STEM_COLOR_VAR } from '~/lib/stems'

interface WaveformProps {
  waveform: WaveformData
  stemType: StemType
  /** Attenue le trace quand la piste est inaudible (coupee ou hors solo). */
  dimmed: boolean
  className?: string
}

/**
 * Forme d'onde dessinee a partir des peaks pre-calcules par le worker.
 *
 * Le client ne decode jamais l'audio pour dessiner : il ne fait que
 * sous-echantillonner un tableau de creetes a la largeur reelle du canvas. Le
 * redimensionnement est observe pour rester net sur les ecrans haute densite.
 */
export function Waveform({ waveform, stemType, dimmed, className }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    const draw = () => {
      const context = canvas.getContext('2d')
      if (!context) return

      const ratio = globalThis.devicePixelRatio || 1
      const width = Math.max(1, Math.floor(parent.clientWidth))
      const height = Math.max(1, Math.floor(parent.clientHeight))

      canvas.width = Math.floor(width * ratio)
      canvas.height = Math.floor(height * ratio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)

      const color = getComputedStyle(canvas).getPropertyValue(STEM_COLOR_VAR[stemType]).trim()
      context.fillStyle = color || '#8ab'
      context.globalAlpha = dimmed ? 0.25 : 0.85

      const peaks = resamplePeaks(waveform, width)
      const middle = height / 2
      for (let x = 0; x < peaks.length; x += 1) {
        // Un plancher d'un pixel garde la piste lisible pendant les silences.
        const amplitude = Math.max(1, (peaks[x] ?? 0) * middle)
        context.fillRect(x, middle - amplitude, 1, amplitude * 2)
      }
    }

    draw()

    const observer = new ResizeObserver(draw)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [waveform, stemType, dimmed])

  return <canvas ref={canvasRef} aria-hidden className={className} />
}
