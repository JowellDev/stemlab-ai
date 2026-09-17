import type { StemType } from '@stemlab/contracts'

/** Libelles et couleurs par type de piste. Les couleurs reprennent les variables
 *  `--color-stem-*` du theme pour que forme d'onde et interface restent coherentes. */
export const STEM_LABELS: Record<StemType, string> = {
  vocals: 'Voix',
  drums: 'Batterie',
  bass: 'Basse',
  guitar: 'Guitare',
  piano: 'Piano',
  other: 'Autres',
}

export const STEM_COLOR_VAR: Record<StemType, string> = {
  vocals: '--color-stem-vocals',
  drums: '--color-stem-drums',
  bass: '--color-stem-bass',
  guitar: '--color-stem-guitar',
  piano: '--color-stem-piano',
  other: '--color-stem-other',
}

export const STEM_TEXT_CLASS: Record<StemType, string> = {
  vocals: 'text-stem-vocals',
  drums: 'text-stem-drums',
  bass: 'text-stem-bass',
  guitar: 'text-stem-guitar',
  piano: 'text-stem-piano',
  other: 'text-stem-other',
}
