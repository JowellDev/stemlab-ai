import { env, isProduction } from '~/lib/env.server'

/**
 * En-tetes de securite.
 *
 * La politique de contenu est nominative (`nonce`) plutot que permissive : un
 * `'unsafe-inline'` sur les scripts rendrait la directive decorative, puisque
 * c'est exactement ce qu'exploite une injection.
 *
 * En developpement, Vite injecte ses propres scripts et ouvre une connexion
 * WebSocket ; la politique y est relachee, faute de quoi rien ne demarre.
 */

/** Origines jointes directement par le navigateur, hors application. */
function externalOrigins(): string[] {
  const origins = new Set<string>()
  for (const url of [env.S3_ENDPOINT]) {
    if (!url) continue
    try {
      origins.add(new URL(url).origin)
    } catch {
      // Valeur non parsable : on l'ignore plutot que de refuser de demarrer.
    }
  }
  return [...origins]
}

export function contentSecurityPolicy(nonce: string): string {
  const external = externalOrigins()

  // Un navigateur ignore `'unsafe-inline'` des qu'un nonce est present. En
  // developpement, ou Vite injecte ses propres scripts en ligne, il faut donc
  // renoncer au nonce plutot que d'ajouter les deux.
  // `blob:` : signalsmith-stretch compile son AudioWorklet a la volee et le
  // charge depuis un blob. Un module d'AudioWorklet releve de `script-src`, pas
  // de `worker-src`. La concession est etroite — seul du script deja execute sur
  // l'origine peut fabriquer un blob, ce qui n'ouvre aucune porte nouvelle.
  const scriptSrc = isProduction
    ? ["'self'", 'blob:', `'nonce-${nonce}'`, "'wasm-unsafe-eval'"]
    : ["'self'", 'blob:', "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'"]

  const connectSrc = ["'self'", ...external]
  if (!isProduction) connectSrc.push('ws:', 'wss:')

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // `wasm-unsafe-eval` : l'etirement temporel est un module WebAssembly.
    'script-src': scriptSrc,
    // Les attributs `style` en ligne sont partout — barres de progression,
    // curseurs, positions d'accords. Les interdire demanderait de reecrire le
    // rendu pour un gain sans rapport avec le risque.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'"],
    'media-src': ["'self'", 'blob:', ...external],
    'connect-src': connectSrc,
    // L'AudioWorklet et le service worker sont charges depuis des blobs.
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  }

  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

export function securityHeaders(nonce: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-security-policy': contentSecurityPolicy(nonce),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    // Aucune de ces capacites n'est utilisee : les refuser evite qu'un script
    // tiers injecte ne les demande.
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'cross-origin-opener-policy': 'same-origin',
    'x-frame-options': 'DENY',
  }

  if (isProduction) {
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains'
  }

  return headers
}
