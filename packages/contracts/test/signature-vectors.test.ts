import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { signBody, verifySignature } from '../src/signature.js'

/**
 * Les memes vecteurs sont verifies cote Python (`apps/ml/tests/test_security.py`).
 * Si les deux suites passent, les deux implementations de la signature concordent —
 * ce qu'aucun test purement local ne peut garantir.
 */

interface Vector {
  secret: string
  body: string
  timestamp: number
  signature: string
}

const { vectors } = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../../fixtures/signature-vectors.json'), 'utf8'),
) as { vectors: Vector[] }

describe('vecteurs de signature partages', () => {
  it('en charge au moins cinq', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(5)
  })

  it.each(vectors)('reproduit la signature de reference (ts=$timestamp)', async (vector) => {
    const signed = await signBody(vector.secret, vector.body, vector.timestamp)
    expect(signed.signature).toBe(vector.signature)
  })

  it.each(vectors)('verifie la signature de reference (ts=$timestamp)', async (vector) => {
    const result = await verifySignature({
      secret: vector.secret,
      body: vector.body,
      signature: vector.signature,
      timestamp: String(vector.timestamp),
      now: vector.timestamp,
    })
    expect(result).toEqual({ ok: true })
  })

  it('rejette une signature d un autre vecteur', async () => {
    const [first, second] = vectors
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    const result = await verifySignature({
      secret: first!.secret,
      body: first!.body,
      signature: second!.signature,
      timestamp: String(first!.timestamp),
      now: first!.timestamp,
    })
    expect(result).toEqual({ ok: false, reason: 'mismatch' })
  })
})
