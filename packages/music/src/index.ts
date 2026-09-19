export { keyId, parseKeyFromName, type ParsedKey } from './key-names.js'
export {
  CHORD_INTERVALS,
  MIDDLE_C,
  chordLabel,
  chordNotes,
  diatonicChords,
  midiToFrequency,
  type ChordColour,
  type ChordFunction,
  type ChordQuality,
  type DiatonicChord,
  type Mode,
  type VoicingOptions,
} from './harmony.js'

export {
  accidentalForKey,
  normalizePitchClass,
  pitchClassIndex,
  pitchClassName,
  type Accidental,
} from './spelling.js'

export {
  MAX_SEMITONES,
  MIN_SEMITONES,
  clampSemitones,
  transposeChordLabel,
  transposeChords,
  transposeKey,
  type TransposedKey,
} from './transpose.js'

export { beatAt, beatIndexAt, chordAt, chordIndexAt, indexAt } from './lookup.js'

export {
  assignChordsToBars,
  barIndexAt,
  buildBars,
  type Bar,
  type BarChord,
  type BarWithChords,
} from './bars.js'
