import { describe, expect, it } from 'vitest'
import { ChordSequence } from '../src/music.js'
import { CreateJobRequest, JobCallback } from '../src/jobs.js'
import { S3Key, stemsForModel } from '../src/primitives.js'

describe('S3Key', () => {
  it.each(['tracks/abc/original.mp3', 'a', "u/o'brien/x-1_2.opus"])('accepte %s', (key) => {
    expect(S3Key.safeParse(key).success).toBe(true)
  })

  it.each(['/leading', 'a/../b', '', 'espace dans la cle', 'cle\navec\nsaut'])(
    'rejette %s',
    (key) => {
      expect(S3Key.safeParse(key).success).toBe(false)
    },
  )
})

describe('stemsForModel', () => {
  it('renvoie 4 stems pour htdemucs et 6 pour htdemucs_6s', () => {
    expect(stemsForModel('htdemucs')).toHaveLength(4)
    expect(stemsForModel('htdemucs_6s')).toHaveLength(6)
  })
})

describe('CreateJobRequest', () => {
  const base = {
    trackId: '11111111-1111-4111-8111-111111111111',
    sourceKey: 'tracks/1/original.mp3',
    checksum: 'a'.repeat(64),
    outputPrefix: 'tracks/1/stems',
    callbackUrl: 'http://localhost:3000/api/internal/jobs/callback',
  }

  it('applique htdemucs par defaut', () => {
    const parsed = CreateJobRequest.parse(base)
    expect(parsed.model).toBe('htdemucs')
  })

  it('rejette un checksum trop court', () => {
    expect(CreateJobRequest.safeParse({ ...base, checksum: 'abc' }).success).toBe(false)
  })
})

describe('JobCallback', () => {
  it('discrimine sur event', () => {
    const parsed = JobCallback.parse({
      event: 'job.progress',
      jobId: '11111111-1111-4111-8111-111111111111',
      trackId: '22222222-2222-4222-8222-222222222222',
      progress: 42,
      stage: 'separation',
    })
    expect(parsed.event).toBe('job.progress')
  })

  it('rejette un event inconnu', () => {
    expect(JobCallback.safeParse({ event: 'job.exploded' }).success).toBe(false)
  })
})

describe('ChordSequence', () => {
  const chord = (start: number, end: number) => ({
    start,
    end,
    label: 'C',
    root: 0,
    quality: '',
    confidence: 0.9,
  })

  it('accepte une suite ordonnee', () => {
    expect(ChordSequence.safeParse([chord(0, 2), chord(2, 4)]).success).toBe(true)
  })

  it('rejette un chevauchement', () => {
    expect(ChordSequence.safeParse([chord(0, 3), chord(2, 4)]).success).toBe(false)
  })

  it('rejette un accord de duree nulle', () => {
    expect(ChordSequence.safeParse([chord(1, 1)]).success).toBe(false)
  })
})
