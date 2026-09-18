import { describe, expect, it } from 'vitest'
import {
  CHORD_INTERVALS,
  MIDDLE_C,
  type ChordQuality,
  chordLabel,
  chordNotes,
  diatonicChords,
  midiToFrequency,
} from '../src/harmony.js'

describe('diatonicChords', () => {
  it('rend la grille de do majeur', () => {
    const grille = diatonicChords(0, 'major')
    expect(grille.map((c) => c.label)).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim', 'Bb'])
  })

  it('rend la grille de la mineur', () => {
    const grille = diatonicChords(9, 'minor')
    expect(grille.map((c) => c.label)).toEqual(['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G', 'E'])
  })

  it('ecrit les bemols dans les tonalites a bemols', () => {
    // En fa majeur, le quatrieme degre s'ecrit Bb — jamais A#.
    expect(diatonicChords(5, 'major').map((c) => c.label)).toContain('Bb')
    expect(diatonicChords(5, 'major').map((c) => c.label)).not.toContain('A#')
  })

  it('propose les deux dominantes en mineur', () => {
    // Le v naturel et le V majeur emprunte : c'est au musicien de choisir.
    const grille = diatonicChords(0, 'minor')
    const degres = grille.map((c) => c.degree)
    expect(degres).toContain('v')
    expect(degres).toContain('V')
  })

  it('ajoute le bVII en majeur', () => {
    const bvii = diatonicChords(0, 'major').find((c) => c.degree === 'bVII')
    expect(bvii?.label).toBe('Bb')
    expect(bvii?.function).toBe('colour')
  })

  it('classe les fonctions tonales', () => {
    const grille = diatonicChords(0, 'major')
    expect(grille.find((c) => c.degree === 'I')?.function).toBe('tonic')
    expect(grille.find((c) => c.degree === 'IV')?.function).toBe('subdominant')
    expect(grille.find((c) => c.degree === 'V')?.function).toBe('dominant')
  })
})

describe('enrichissement', () => {
  it('transforme toute la grille en sus4', () => {
    const grille = diatonicChords(0, 'major', 'sus4')
    expect(grille.find((c) => c.degree === 'I')?.label).toBe('Csus4')
    expect(grille.find((c) => c.degree === 'ii')?.label).toBe('Dsus4')
  })

  it('distingue septieme majeure et mineure', () => {
    const grille = diatonicChords(0, 'major', 'seventh')
    expect(grille.find((c) => c.degree === 'I')?.label).toBe('Cmaj7')
    expect(grille.find((c) => c.degree === 'ii')?.label).toBe('Dm7')
  })

  it('laisse l accord diminue intact sous un sus', () => {
    // Retirer la tierce d'un accord diminue lui ote son identite : mieux vaut ne
    // rien faire que produire un accord faux.
    const grille = diatonicChords(0, 'major', 'sus4')
    expect(grille.find((c) => c.degree === 'vii°')?.label).toBe('Bdim')
  })

  it('rend le diminue en demi-diminue sous une septieme', () => {
    const grille = diatonicChords(0, 'major', 'seventh')
    expect(grille.find((c) => c.degree === 'vii°')?.label).toBe('Bm7b5')
  })

  it('choisit la neuvieme mineure sur un degre mineur', () => {
    const grille = diatonicChords(0, 'major', 'add9')
    expect(grille.find((c) => c.degree === 'I')?.label).toBe('Cadd9')
    expect(grille.find((c) => c.degree === 'vi')?.label).toBe('Am9')
  })
})

describe('chordNotes', () => {
  it('empile un accord parfait majeur sur le do central', () => {
    expect(chordNotes(0, 'maj')).toEqual([MIDDLE_C, MIDDLE_C + 4, MIDDLE_C + 7])
  })

  it('ajoute la basse une octave plus bas', () => {
    const notes = chordNotes(0, 'maj', { bass: true })
    expect(notes[0]).toBe(MIDDLE_C - 12)
    expect(notes).toHaveLength(4)
  })

  it('ecarte une note sur deux', () => {
    // Fondamentale et quinte en bas, tierce au-dessus : c'est ce qui evite la
    // bouillie d'un accord serre dans le grave.
    const notes = chordNotes(0, 'maj', { spread: true })
    expect(notes).toEqual([MIDDLE_C, MIDDLE_C + 7, MIDDLE_C + 16])
  })

  it('ne rend jamais deux fois la meme note', () => {
    for (const quality of Object.keys(CHORD_INTERVALS) as ChordQuality[]) {
      const notes = chordNotes(0, quality, { bass: true, spread: true })
      expect(new Set(notes).size, quality).toBe(notes.length)
    }
  })

  it('rend les notes dans l ordre croissant', () => {
    for (const quality of Object.keys(CHORD_INTERVALS) as ChordQuality[]) {
      const notes = chordNotes(7, quality, { bass: true, spread: true })
      expect([...notes].sort((a, b) => a - b), quality).toEqual(notes)
    }
  })

  it('transpose avec l octave', () => {
    expect(chordNotes(0, 'maj', { octave: 3 })[0]).toBe(MIDDLE_C - 12)
    expect(chordNotes(0, 'maj', { octave: 5 })[0]).toBe(MIDDLE_C + 12)
  })
})

describe('midiToFrequency', () => {
  it('place le la 4 a 440 Hz', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 6)
  })

  it('double la frequence a chaque octave', () => {
    expect(midiToFrequency(81)).toBeCloseTo(880, 6)
    expect(midiToFrequency(57)).toBeCloseTo(220, 6)
  })

  it('place le do central a 261,63 Hz', () => {
    expect(midiToFrequency(MIDDLE_C)).toBeCloseTo(261.626, 3)
  })
})

describe('chordLabel', () => {
  it('n ajoute rien a un accord majeur', () => {
    expect(chordLabel(0, 'maj')).toBe('C')
  })

  it('suit l orthographe demandee', () => {
    expect(chordLabel(10, 'maj', 'flat')).toBe('Bb')
    expect(chordLabel(10, 'maj', 'sharp')).toBe('A#')
  })
})
