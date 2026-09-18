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
