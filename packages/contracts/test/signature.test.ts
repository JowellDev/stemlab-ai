import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOLERANCE_SECONDS,
  signBody,
  timingSafeEqualHex,
  verifySignature,
} from '../src/signature.js'

const SECRET = 'test-secret'
const BODY = JSON.stringify({ event: 'job.succeeded', jobId: 'abc' })

describe('signBody', () => {
  it('produit une signature hexadecimale stable de 64 caracteres', async () => {
    const a = await signBody(SECRET, BODY, 1_700_000_000)
    const b = await signBody(SECRET, BODY, 1_700_000_000)
    expect(a.signature).toMatch(/^[a-f0-9]{64}$/)
    expect(a.signature).toBe(b.signature)
  })

  it('change de signature si le timestamp change', async () => {
    const a = await signBody(SECRET, BODY, 1_700_000_000)
    const b = await signBody(SECRET, BODY, 1_700_000_001)
    expect(a.signature).not.toBe(b.signature)
  })

  it('change de signature si le corps change d un seul octet', async () => {
    const a = await signBody(SECRET, BODY, 1_700_000_000)
    const b = await signBody(SECRET, `${BODY} `, 1_700_000_000)
    expect(a.signature).not.toBe(b.signature)
  })
})

describe('verifySignature', () => {
  const now = 1_700_000_000

  it('accepte une signature valide dans la fenetre de tolerance', async () => {
    const { signature } = await signBody(SECRET, BODY, now)
    await expect(
      verifySignature({ secret: SECRET, body: BODY, signature, timestamp: String(now), now }),
    ).resolves.toEqual({ ok: true })
  })

  it('rejette un secret different', async () => {
    const { signature } = await signBody('autre-secret', BODY, now)
    await expect(
      verifySignature({ secret: SECRET, body: BODY, signature, timestamp: String(now), now }),
    ).resolves.toEqual({ ok: false, reason: 'mismatch' })
  })

  it('rejette un rejeu hors fenetre', async () => {
    const old = now - DEFAULT_TOLERANCE_SECONDS - 1
    const { signature } = await signBody(SECRET, BODY, old)
    await expect(
      verifySignature({ secret: SECRET, body: BODY, signature, timestamp: String(old), now }),
    ).resolves.toEqual({ ok: false, reason: 'expired' })
  })

  it('rejette un timestamp futur hors fenetre', async () => {
    const future = now + DEFAULT_TOLERANCE_SECONDS + 1
    const { signature } = await signBody(SECRET, BODY, future)
    await expect(
      verifySignature({ secret: SECRET, body: BODY, signature, timestamp: String(future), now }),
    ).resolves.toEqual({ ok: false, reason: 'expired' })
  })

  it('rejette des en-tetes manquants', async () => {
    await expect(
      verifySignature({ secret: SECRET, body: BODY, signature: null, timestamp: String(now), now }),
    ).resolves.toEqual({ ok: false, reason: 'missing-headers' })
  })

  it('rejette un timestamp non numerique', async () => {
    const { signature } = await signBody(SECRET, BODY, now)
    await expect(
      verifySignature({ secret: SECRET, body: BODY, signature, timestamp: 'hier', now }),
    ).resolves.toEqual({ ok: false, reason: 'bad-timestamp' })
  })
})

describe('timingSafeEqualHex', () => {
  it('compare correctement', () => {
    expect(timingSafeEqualHex('abcd', 'abcd')).toBe(true)
    expect(timingSafeEqualHex('abcd', 'abce')).toBe(false)
    expect(timingSafeEqualHex('abcd', 'abc')).toBe(false)
  })
})
