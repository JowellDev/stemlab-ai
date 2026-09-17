/**
 * Signature HMAC partagee entre le BFF (Node) et le service ML (Python).
 *
 * Chaine signee : `${timestamp}.${body}` ou `timestamp` est un epoch en secondes
 * et `body` le corps HTTP brut, octet pour octet. Le meme schema est utilise dans
 * les deux sens (BFF -> ML et webhook ML -> BFF), avec le meme secret partage.
 * La comparaison est faite en temps constant et la fenetre de tolerance rejette
 * les rejeux tardifs.
 */

export const SIGNATURE_HEADER = 'x-stemlab-signature'
export const TIMESTAMP_HEADER = 'x-stemlab-timestamp'
export const DEFAULT_TOLERANCE_SECONDS = 300

export function signedPayload(timestamp: number, body: string): string {
  return `${timestamp}.${body}`
}

const encoder = new TextEncoder()

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Renvoie la signature hexadecimale minuscule, sans prefixe. */
export async function signBody(
  secret: string,
  body: string,
  timestamp: number,
): Promise<{ signature: string; timestamp: number }> {
  const key = await hmacKey(secret)
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload(timestamp, body)))
  return { signature: toHex(mac), timestamp }
}

/** Comparaison en temps constant de deux chaines hexadecimales. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

export type SignatureVerification =
  { ok: true } | { ok: false; reason: 'missing-headers' | 'bad-timestamp' | 'expired' | 'mismatch' }

export async function verifySignature(options: {
  secret: string
  body: string
  signature: string | null | undefined
  timestamp: string | null | undefined
  toleranceSeconds?: number
  now?: number
}): Promise<SignatureVerification> {
  const { secret, body, signature, timestamp } = options
  if (!signature || !timestamp) return { ok: false, reason: 'missing-headers' }

  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || !Number.isInteger(ts)) return { ok: false, reason: 'bad-timestamp' }

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  const now = options.now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > tolerance) return { ok: false, reason: 'expired' }

  const expected = await signBody(secret, body, ts)
  return timingSafeEqualHex(expected.signature, signature)
    ? { ok: true }
    : { ok: false, reason: 'mismatch' }
}
