import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PipelineResult } from '../src/jobs.js'
import { stemsForModel } from '../src/primitives.js'

/**
 * Validation croisee Python -> TypeScript.
 *
 * Le pipeline serialise avec ses modeles pydantic, le BFF valide avec ces schemas
 * Zod : rien ne garantit que les deux decrivent la meme chose, sinon un test qui
 * fait passer une vraie sortie de l'un dans l'autre. Les fixtures sont des sorties
 * reelles de `python -m ml.pipeline`, avec les peaks tronques a 64 points pour ne
 * pas alourdir le depot — c'est la forme qui est verifiee, pas le contenu audio.
 */

const FIXTURES_DIR = join(import.meta.dirname, '../../../fixtures/analysis')

function loadFixtures(): Array<[string, unknown]> {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => [name, JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'))])
}

const fixtures = loadFixtures()

describe('sortie du pipeline ML', () => {
  it('trouve des fixtures a valider', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(3)
  })

  it.each(fixtures)('%s est conforme au schema PipelineResult', (_name, payload) => {
    const parsed = PipelineResult.safeParse(payload)
    if (!parsed.success) {
      throw new Error(`schema rejete : ${JSON.stringify(parsed.error.issues, null, 2)}`)
    }
  })

  it.each(fixtures)('%s contient les stems attendus pour son modele', (_name, payload) => {
    const result = PipelineResult.parse(payload)
    const expected = new Set(stemsForModel(result.model))
    expect(new Set(result.stems.map((stem) => stem.type))).toEqual(expected)
  })

  it.each(fixtures)('%s a des accords ordonnes et contigus', (_name, payload) => {
    const { chords } = PipelineResult.parse(payload).analysis
    expect(chords.length).toBeGreaterThan(0)
    for (const [index, chord] of chords.entries()) {
      expect(chord.end).toBeGreaterThan(chord.start)
      if (index > 0) expect(chord.start).toBeCloseTo(chords[index - 1]!.end, 6)
    }
  })

  it.each(fixtures)('%s a une grille de temps croissante', (_name, payload) => {
    const { beats, timeSignature } = PipelineResult.parse(payload).analysis
    expect(beats.length).toBeGreaterThan(0)
    for (const [index, beat] of beats.entries()) {
      expect(beat.position).toBeLessThanOrEqual(timeSignature.numerator)
      if (index > 0) expect(beat.time).toBeGreaterThan(beats[index - 1]!.time)
    }
  })

  it.each(fixtures)('%s couvre le morceau sans depasser sa duree', (_name, payload) => {
    const result = PipelineResult.parse(payload)
    const last = result.analysis.chords.at(-1)
    expect(last?.end).toBeLessThanOrEqual(result.durationSeconds + 0.5)
    expect(result.analysis.firstBeatOffset).toBeLessThan(result.durationSeconds)
  })
})
