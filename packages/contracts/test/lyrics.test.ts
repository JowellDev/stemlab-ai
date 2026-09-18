import { describe, expect, it } from 'vitest'
import {
  type LyricLine,
  Lyrics,
  availableLanguages,
  lineAt,
  wordAt,
} from '../src/lyrics.js'

function ligne(start: number, end: number, text: string, mots: [number, number, string][] = []) {
  return {
    start,
    end,
    text,
    words: mots.map(([s, e, t]) => ({ start: s, end: e, text: t })),
  } satisfies LyricLine
}

const LIGNES = [
  ligne(0, 2, 'Premiere ligne', [
    [0, 0.8, 'Premiere'],
    [0.9, 2, 'ligne'],
  ]),
  ligne(5, 7, 'Deuxieme ligne'),
  ligne(7, 9, 'Troisieme ligne'),
]

describe('lineAt', () => {
  it('ne designe rien avant la premiere ligne', () => {
    expect(lineAt(LIGNES, 0)).toBe(0)
    expect(lineAt(LIGNES, -1)).toBe(-1)
  })

  it('suit la ligne en cours', () => {
    expect(lineAt(LIGNES, 1)).toBe(0)
    expect(lineAt(LIGNES, 5.5)).toBe(1)
    expect(lineAt(LIGNES, 8)).toBe(2)
  })

  it('garde la derniere ligne pendant un silence', () => {
    // Entre 2 s et 5 s, aucune ligne ne couvre l'instant. La faire disparaitre
    // ferait clignoter l'affichage a chaque respiration.
    expect(lineAt(LIGNES, 3)).toBe(0)
  })

  it('garde la derniere ligne apres la fin', () => {
    expect(lineAt(LIGNES, 120)).toBe(2)
  })

  it('rend -1 sur des paroles vides', () => {
    expect(lineAt([], 4)).toBe(-1)
  })
})

describe('wordAt', () => {
  it('designe le mot qui couvre l instant', () => {
    expect(wordAt(LIGNES[0]!, 0.4)).toBe(0)
    expect(wordAt(LIGNES[0]!, 1.5)).toBe(1)
  })

  it('ne designe rien dans un intervalle entre deux mots', () => {
    expect(wordAt(LIGNES[0]!, 0.85)).toBe(-1)
  })

  it('ne designe rien quand la ligne n est pas decoupee', () => {
    expect(wordAt(LIGNES[1]!, 6)).toBe(-1)
  })

  it('exclut la borne de fin', () => {
    // Sinon deux mots consecutifs seraient actifs au meme instant.
    expect(wordAt(LIGNES[0]!, 0.8)).toBe(-1)
  })
})

describe('availableLanguages', () => {
  const base = {
    language: 'fr',
    languageConfidence: 0.9,
    lines: LIGNES,
    translations: {},
  }

  it('compte la langue d origine', () => {
    expect(availableLanguages(base)).toEqual(['fr'])
  })

  it('ajoute les traductions completes', () => {
    const avec = { ...base, translations: { en: ['One', 'Two', 'Three'] } }
    expect(availableLanguages(avec).sort()).toEqual(['en', 'fr'])
  })

  it('ecarte une traduction incomplete', () => {
    // Une traduction plus courte que les paroles decalerait tout l'affichage.
    const partielle = { ...base, translations: { en: ['One'] } }
    expect(availableLanguages(partielle)).toEqual(['fr'])
  })

  it('n invente pas de langue quand la detection a echoue', () => {
    expect(availableLanguages({ ...base, language: null })).toEqual([])
  })
})

describe('schema', () => {
  it('accepte une sortie de pipeline reelle', () => {
    const parsed = Lyrics.safeParse({
      language: 'en',
      languageConfidence: 0.945,
      lines: [
        {
          start: 0,
          end: 7.44,
          text: 'And so, my fellow Americans',
          words: [{ start: 0, end: 0.52, text: 'And' }],
        },
      ],
      translations: { fr: ['Et donc, mes compatriotes'] },
    })
    expect(parsed.success).toBe(true)
  })

  it('refuse une ligne vide', () => {
    const parsed = Lyrics.safeParse({
      language: 'en',
      languageConfidence: 0.9,
      lines: [{ start: 0, end: 1, text: '', words: [] }],
      translations: {},
    })
    expect(parsed.success).toBe(false)
  })
})
