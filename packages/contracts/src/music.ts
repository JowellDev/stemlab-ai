import { z } from 'zod'
import { Confidence, Seconds } from './primitives.js'

export const PITCH_CLASSES = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
] as const
export type PitchClass = (typeof PITCH_CLASSES)[number]

export const PitchClassSchema = z.enum(PITCH_CLASSES)

export const KeyMode = z.enum(['major', 'minor'])
export type KeyMode = z.infer<typeof KeyMode>

/**
 * Un accord detecte. `label` est la notation affichee (ex. "Am7", "F#", "N" pour silence).
 * Les bornes sont alignees sur la grille de temps produite par l'analyse.
 */
export const Chord = z.object({
  start: Seconds,
  end: Seconds,
  label: z.string().min(1).max(16),
  /** Fondamentale en pitch class 0-11, `null` pour un segment sans accord ("N"). */
  root: z.number().int().min(0).max(11).nullable(),
  quality: z.string().min(0).max(16),
  confidence: Confidence,
})
export type Chord = z.infer<typeof Chord>

export const Beat = z.object({
  time: Seconds,
  /** Position dans la mesure, 1-indexee. 1 = temps fort. */
  position: z.number().int().min(1).max(32),
})
export type Beat = z.infer<typeof Beat>

export const TimeSignature = z.object({
  numerator: z.number().int().min(1).max(32),
  denominator: z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
})
export type TimeSignature = z.infer<typeof TimeSignature>

/**
 * Peaks de forme d'onde pre-calcules cote worker : le client ne decode jamais
 * l'audio complet pour dessiner. Valeurs normalisees 0..1 (amplitude absolue).
 */
export const Waveform = z.object({
  pointsPerSecond: z.number().int().min(1).max(2000),
  /** Un point = amplitude crete absolue sur la fenetre correspondante. */
  peaks: z.array(z.number().min(0).max(1)),
})
export type Waveform = z.infer<typeof Waveform>

export const AnalysisResult = z.object({
  key: PitchClassSchema,
  mode: KeyMode,
  keyConfidence: Confidence,
  bpm: z.number().min(20).max(300),
  /** Instant du premier temps fort, en secondes. */
  firstBeatOffset: Seconds,
  timeSignature: TimeSignature,
  beats: z.array(Beat),
  chords: z.array(Chord),
})
export type AnalysisResult = z.infer<typeof AnalysisResult>

/** Verifie qu'une suite d'accords est monotone et sans chevauchement. */
export const ChordSequence = z
  .array(Chord)
  .refine(
    (chords) =>
      chords.every((c, i) => c.end > c.start && (i === 0 || c.start >= (chords[i - 1]?.end ?? 0))),
    'les accords doivent etre ordonnes, non vides et sans chevauchement',
  )
