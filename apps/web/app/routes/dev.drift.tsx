import { createPlaybackEngine } from '@stemlab/audio-engine'
import type { LoadedStem } from '@stemlab/audio-engine'
import type { StemType } from '@stemlab/contracts'
import { useEffect, useRef } from 'react'
import type { Route } from './+types/dev.drift'

/**
 * Banc de mesure de la derive entre pistes.
 *
 * Chaque piste recoit des impulsions aux memes instants. Apres etirement, ces
 * impulsions doivent rester alignees a l'echantillon pres d'une piste a l'autre :
 * c'est la definition operationnelle d'une absence de derive.
 *
 * La mesure passe par `OfflineAudioContext` et par le **vrai** moteur de
 * l'application : elle rend cinq minutes d'audio en quelques dizaines de secondes,
 * et verifie le chemin reellement emprunte en production.
 */

const STEM_TYPES: StemType[] = ['vocals', 'drums', 'bass', 'other']
const PULSE_PERIOD_SECONDS = 10

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Mesure de derive — STEMLAB' }, { name: 'robots', content: 'noindex' }]
}

export interface DriftMeasurement {
  stems: number
  inputSeconds: number
  renderedSeconds: number
  rate: number
  semitones: number
  eventsMeasured: number
  /** Ecart maximal, en echantillons, entre les pistes sur un meme evenement. */
  maxSpreadSamples: number
  independentPitch: boolean
}

declare global {
  interface Window {
    __measureDrift?: (options: {
      seconds: number
      rate: number
      semitones: number
      sampleRate?: number
    }) => Promise<DriftMeasurement>
  }
}

export default function DevDrift() {
  const statusRef = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    window.__measureDrift = measureDrift
    // Ecriture directe plutot qu'un etat : cette page n'a rien a re-rendre, et
    // basculer un etat depuis un effet declenche un rendu en cascade pour rien.
    if (statusRef.current) statusRef.current.textContent = 'pret'
    return () => {
      delete window.__measureDrift
    }
  }, [])

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 py-12">
      <p className="text-brand font-mono text-xs uppercase tracking-[0.3em]">
        STEMLAB · banc de mesure
      </p>
      <h1 className="text-2xl font-semibold">Derive entre pistes</h1>
      <p className="text-muted-foreground text-sm">
        Cette page n&apos;a pas d&apos;interface : elle expose une fonction de mesure appelee par la
        suite de tests. Chaque piste recoit des impulsions aux memes instants ; apres etirement,
        elles doivent rester alignees a l&apos;echantillon pres.
      </p>
      <p ref={statusRef} data-testid="drift-status" className="font-mono text-sm">
        chargement
      </p>
    </main>
  )
}

async function measureDrift(options: {
  seconds: number
  rate: number
  semitones: number
  sampleRate?: number
}): Promise<DriftMeasurement> {
  const sampleRate = options.sampleRate ?? 44_100
  const inputLength = Math.round(options.seconds * sampleRate)
  const outputLength = Math.ceil(inputLength / options.rate) + 4 * sampleRate

  const offline = new OfflineAudioContext({
    numberOfChannels: STEM_TYPES.length * 2,
    length: outputLength,
    sampleRate,
  })

  const stems = STEM_TYPES.map((type) => ({
    type,
    buffer: makePulseBuffer(offline, inputLength, sampleRate),
  })) satisfies LoadedStem[]

  const engine = await createPlaybackEngine(offline, stems)

  // Chaque piste est routee vers sa propre paire de canaux : c'est ce qui permet
  // de comparer les instants d'une piste a l'autre dans le rendu.
  const merger = offline.createChannelMerger(STEM_TYPES.length * 2)
  for (const [index, stem] of stems.entries()) {
    const output = engine.outputFor(stem.type)
    if (!output) continue
    const splitter = offline.createChannelSplitter(2)
    output.connect(splitter)
    splitter.connect(merger, 0, index * 2)
    splitter.connect(merger, 1, index * 2 + 1)
  }
  merger.connect(offline.destination)

  engine.start({ when: 0, offset: 0, rate: options.rate, semitones: options.semitones })

  const rendered = await offline.startRendering()

  const perChannel: number[][] = []
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    perChannel.push(onsets(rendered.getChannelData(channel)))
  }

  const count = Math.min(...perChannel.map((list) => list.length))
  let maxSpread = 0
  for (let index = 0; index < count; index += 1) {
    const positions = perChannel.map((list) => list[index] ?? 0)
    maxSpread = Math.max(maxSpread, Math.max(...positions) - Math.min(...positions))
  }

  return {
    stems: STEM_TYPES.length,
    inputSeconds: options.seconds,
    renderedSeconds: Number(rendered.duration.toFixed(2)),
    rate: options.rate,
    semitones: options.semitones,
    eventsMeasured: count,
    maxSpreadSamples: maxSpread,
    independentPitch: engine.supportsIndependentPitch,
  }
}

/** Impulsions regulieres, identiques sur les deux canaux. */
function makePulseBuffer(
  context: BaseAudioContext,
  length: number,
  sampleRate: number,
): AudioBuffer {
  const buffer = context.createBuffer(2, length, sampleRate)
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let at = 0; at < length; at += PULSE_PERIOD_SECONDS * sampleRate) {
      data[at] = 1
    }
  }
  return buffer
}

/** Indices des fronts detectes dans un canal. */
function onsets(channel: Float32Array, threshold = 0.08, release = 0.01): number[] {
  const found: number[] = []
  let armed = true

  for (let index = 0; index < channel.length; index += 1) {
    const value = Math.abs(channel[index] ?? 0)
    if (armed && value > threshold) {
      found.push(index)
      armed = false
    } else if (!armed && value < release) {
      armed = true
    }
  }

  return found
}
