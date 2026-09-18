import { StemlabError } from '@stemlab/contracts'
import { createClient, type RedisClientType } from 'redis'
import { env, isProduction } from '~/lib/env.server'
import { logger } from '~/lib/logger.server'

/**
 * Limitation de debit, par fenetre fixe.
 *
 * Une fenetre fixe plutot qu'un seau a jetons : deux commandes Redis, aucun etat
 * a maintenir, et un comportement que l'on peut expliquer a l'utilisateur en une
 * phrase. Son defaut connu — jusqu'a deux fois la limite a cheval sur deux
 * fenetres — est sans consequence ici, ou il s'agit d'ecarter les abus, pas de
 * facturer a l'appel pres.
 *
 * Le compteur vit dans Redis parce que l'application tourne en plusieurs
 * instances : un compteur local diviserait la limite par le nombre de machines,
 * sans que personne ne s'en apercoive.
 */

export interface RateLimitRule {
  readonly limit: number
  readonly windowSeconds: number
}

export interface RateLimitResult {
  readonly allowed: boolean
  readonly remaining: number
  /** Secondes avant la remise a zero de la fenetre. */
  readonly retryAfter: number
}

export const RATE_LIMITS = {
  /** Connexion et inscription : vise le bourrage d'identifiants. */
  auth: { limit: env.RATE_LIMIT_AUTH, windowSeconds: 60 },
  /** Preparation d'un envoi : chaque appel signe une URL et cree une ligne. */
  upload: { limit: env.RATE_LIMIT_UPLOAD, windowSeconds: 60 },
  /** Tout le reste des routes d'API, large par dessein. */
  api: { limit: env.RATE_LIMIT_API, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>

export async function consume(
  bucket: string,
  identity: string,
  rule: RateLimitRule,
  now = Date.now(),
): Promise<RateLimitResult> {
  const window = Math.floor(now / 1000 / rule.windowSeconds)
  const key = `stemlab:rl:${bucket}:${identity}:${window}`
  const retryAfter = rule.windowSeconds - Math.floor(now / 1000) + window * rule.windowSeconds

  const count = await increment(key, rule.windowSeconds)

  // Compteur indisponible : on laisse passer. Une limitation qui tombe en panne
  // ne doit pas fermer le service qu'elle protege.
  if (count === null) return { allowed: true, remaining: rule.limit, retryAfter }

  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfter,
  }
}

/**
 * Applique une limite et refuse l'appel au-dela.
 *
 * L'identite est l'utilisateur quand il est connu, l'adresse sinon : limiter par
 * adresse seule punirait tout un reseau d'entreprise pour un seul abus.
 */
export async function enforce(
  bucket: keyof typeof RATE_LIMITS,
  identity: string,
  now = Date.now(),
): Promise<void> {
  const rule = RATE_LIMITS[bucket]
  const result = await consume(bucket, identity, rule, now)
  if (result.allowed) return

  throw new StemlabError('rate_limited', 'Trop de requetes. Reessayez dans un instant.', {
    retryAfter: [String(result.retryAfter)],
  })
}

/**
 * Identite a limiter : l'utilisateur, ou l'adresse d'origine.
 *
 * `x-forwarded-for` n'est digne de foi que derriere un proxy qui le reecrit.
 * Hors production, on ne s'y fie pas : n'importe qui pourrait s'attribuer une
 * identite neuve a chaque appel.
 */
export function identify(request: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`

  const forwarded = isProduction ? request.headers.get('x-forwarded-for') : null
  const address = forwarded?.split(',')[0]?.trim()
  return `ip:${address || 'inconnu'}`
}

// --- acces au compteur -----------------------------------------------------

let client: RedisClientType | null = null
let connecting: Promise<RedisClientType | null> | null = null

/** Repli local, utilise quand Redis n'est pas configure ou pas joignable. */
const local = new Map<string, { count: number; expiresAt: number }>()

async function increment(key: string, ttlSeconds: number): Promise<number | null> {
  const redis = await connect()

  if (redis) {
    try {
      const count = await redis.incr(key)
      if (count === 1) await redis.expire(key, ttlSeconds)
      return count
    } catch (error) {
      logger.warn('limitation de debit : Redis indisponible', { error: describe(error) })
    }
  }

  return incrementLocally(key, ttlSeconds)
}

function incrementLocally(key: string, ttlSeconds: number): number {
  const now = Date.now()
  // Purge opportuniste : sans elle, la table grandirait indefiniment.
  if (local.size > 10_000) {
    for (const [name, entry] of local) if (entry.expiresAt <= now) local.delete(name)
  }

  const entry = local.get(key)
  if (!entry || entry.expiresAt <= now) {
    local.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 })
    return 1
  }

  entry.count += 1
  return entry.count
}

async function connect(): Promise<RedisClientType | null> {
  if (!env.REDIS_URL) return null
  if (client?.isReady) return client

  connecting ??= (async () => {
    try {
      const created = createClient({ url: env.REDIS_URL }) as RedisClientType
      // Sans ce gestionnaire, une coupure remonte en exception non capturee et
      // arrete le processus.
      created.on('error', (error: unknown) => {
        logger.warn('Redis en erreur', { error: describe(error) })
      })
      await created.connect()
      client = created
      return created
    } catch (error) {
      logger.warn('Redis injoignable : limitation locale a l instance', {
        error: describe(error),
      })
      return null
    } finally {
      connecting = null
    }
  })()

  return connecting
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Message a afficher dans un formulaire quand la limite est atteinte.
 *
 * Les pages d'authentification rendent leurs erreurs elles-memes : une reponse
 * JSON n'y a pas sa place, et laisser remonter l'exception afficherait une page
 * d'erreur la ou l'utilisateur doit simplement patienter.
 */
export function rateLimitMessage(error: unknown): string {
  if (error instanceof StemlabError && error.code === 'rate_limited') return error.message
  throw error
}
