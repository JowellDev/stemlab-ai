/**
 * Reexports internes, pour que les modules du paquet ne dependent pas de son
 * point d'entree — une dependance circulaire qui casse selon l'ordre de
 * chargement.
 */
export { normalizePitchClass, pitchClassIndex } from './spelling.js'
export type { Mode } from './harmony.js'
