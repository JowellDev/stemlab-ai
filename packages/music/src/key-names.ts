import { type Mode, normalizePitchClass, pitchClassIndex } from './index-internal.js'

/**
 * Reconnaissance d'une tonalite dans un nom de fichier.
 *
 * Les bibliotheques de nappes vendent un fichier par tonalite, et chacune les
 * nomme a sa facon : `C.wav`, `Pad - F# Major.mp3`, `Ambient_Bbm_loop.wav`,
 * `05 - E minor.aif`. Plutot que d'imposer une convention, on cherche la
 * tonalite dans le nom — et on laisse l'utilisateur corriger quand on se trompe.
 */

export interface ParsedKey {
  /** Classe de hauteur, 0-11. */
  readonly root: number
  readonly mode: Mode
}

/**
 * Une tonalite, seule, occupant un jeton entier : `C`, `F#`, `Bbm`, `Amaj`.
 *
 * Le jeton entier, et non une sous-chaine : chercher une lettre n'importe ou
 * lirait `A` dans `Ambient`, `D` dans `Dwell` et `G` dans `Grandiose`. Les noms
 * de fichiers en sont pleins.
 */
const KEY_TOKEN = /^([A-Ga-g])([#b♯♭]?)(maj(?:or)?|min(?:or)?|m)?$/

/** Un mode ecrit separement : `E minor`, `F# Major`. */
const MODE_TOKEN = /^(maj(?:or)?|min(?:or)?)$/i

function modeFrom(suffix: string | undefined): Mode | null {
  if (!suffix) return null
  return /^m(in(or)?)?$/i.test(suffix) ? 'minor' : 'major'
}

/**
 * Extrait une tonalite d'un nom de fichier, ou `null` si rien n'est reconnu.
 *
 * Le mode peut etre colle a la note (`Bbm`) ou la suivre (`E minor`). En son
 * absence, le majeur est choisi : beaucoup de bibliotheques ne le precisent pas,
 * une nappe tenue etant souvent jouable dans les deux.
 */
export function parseKeyFromName(name: string): ParsedKey | null {
  const jetons = name
    .replace(/\.[a-z0-9]+$/i, '')
    .split(/[\s_\-.]+/)
    .filter(Boolean)

  for (const [index, jeton] of jetons.entries()) {
    const trouve = KEY_TOKEN.exec(jeton)
    if (!trouve) continue

    const alteration = (trouve[2] ?? '').replace('♯', '#').replace('♭', 'b')
    const root = pitchClassIndex(`${trouve[1]!.toUpperCase()}${alteration}`)
    if (root === null) continue

    const colle = modeFrom(trouve[3])
    const suivant = jetons[index + 1]
    const separe = suivant && MODE_TOKEN.test(suivant) ? modeFrom(suivant) : null

    return { root: normalizePitchClass(root), mode: colle ?? separe ?? 'major' }
  }

  return null
}

/** Identifiant stable d'une tonalite : `7-major`, `9-minor`. */
export function keyId(root: number, mode: Mode): string {
  return `${normalizePitchClass(root)}-${mode}`
}
