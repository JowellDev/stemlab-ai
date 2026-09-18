import { StemlabError, Uuid } from '@stemlab/contracts'

/**
 * Identifiant de morceau tire de l'URL.
 *
 * Une valeur hors forme ne doit pas atteindre la base : la requete y repondrait
 * « introuvable », ce qui est le bon resultat mais pour la mauvaise raison, et
 * couterait un aller-retour a chaque sonde automatique.
 */
export function parseTrackId(value: string | undefined): string {
  const parsed = Uuid.safeParse(value)
  if (!parsed.success) throw new StemlabError('not_found', 'Morceau introuvable.')
  return parsed.data
}
