/**
 * Programmes General MIDI retenus pour le pad.
 *
 * La norme en compte cent vingt-huit ; une dizaine seulement tient une note
 * assez longtemps pour servir de nappe. Les autres — un piano, une guitare
 * pincee — s'eteignent en deux secondes et n'ont rien a faire ici.
 *
 * Les numeros sont ceux de la norme, comptes a partir de zero.
 */
export interface PadProgram {
  readonly value: number
  readonly label: string
  readonly hint: string
}

export const PAD_PROGRAMS: readonly PadProgram[] = [
  { value: 89, label: 'Nappe chaude', hint: 'Pad 2 (warm) — la nappe de reference' },
  { value: 88, label: 'Nouvel age', hint: 'Pad 1 (new age) — claire et large' },
  { value: 91, label: 'Choeur', hint: 'Pad 4 (choir) — voix tenues' },
  { value: 94, label: 'Halo', hint: 'Pad 7 (halo) — diffuse, sans attaque' },
  { value: 95, label: 'Balayage', hint: 'Pad 8 (sweep) — filtre qui s ouvre' },
  { value: 92, label: 'Archet', hint: 'Pad 5 (bowed) — cordes frottees' },
  { value: 48, label: 'Cordes', hint: 'String Ensemble 1 — un vrai ensemble' },
  { value: 50, label: 'Cordes synth', hint: 'Synth Strings 1' },
  { value: 52, label: 'Choeur aahs', hint: 'Choir Aahs — voix sur « ah »' },
  { value: 53, label: 'Voix', hint: 'Voice Oohs — voix sur « ouh »' },
  { value: 99, label: 'Atmosphere', hint: 'FX 4 (atmosphere)' },
  { value: 100, label: 'Eclat', hint: 'FX 5 (brightness)' },
]

export function programLabel(value: number): string {
  return PAD_PROGRAMS.find((program) => program.value === value)?.label ?? `Programme ${value}`
}
