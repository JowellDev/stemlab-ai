import { AsyncLocalStorage } from 'node:async_hooks'
import { env, isProduction } from '~/lib/env.server'

/**
 * Journalisation structuree.
 *
 * Une ligne JSON par evenement en production : c'est ce que les collecteurs
 * savent lire, et cela evite d'avoir a reconstituer un message a coups
 * d'expressions regulieres. En developpement, une ligne lisible a l'oeil — un
 * JSON compact dans un terminal ne se lit pas.
 *
 * Le contexte de requete passe par un stockage asynchrone plutot que par un
 * argument : sans cela, chaque fonction du chemin devrait porter un identifiant
 * dont elle n'a que faire.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const SEVERITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface RequestContext {
  readonly requestId: string
  /** Nonce de la politique de contenu, partage par l'en-tete et le rendu. */
  readonly nonce: string
  readonly method: string
  readonly path: string
  userId?: string
}

const storage = new AsyncLocalStorage<RequestContext>()

export function runWithRequestContext<T>(context: RequestContext, task: () => T): T {
  return storage.run(context, task)
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore()
}

/** Attache l'utilisateur au contexte courant, une fois la session resolue. */
export function tagUser(userId: string): void {
  const context = storage.getStore()
  if (context) context.userId = userId
}

export type LogFields = Record<string, unknown>

function emit(level: LogLevel, message: string, fields: LogFields = {}): void {
  if (SEVERITY[level] < SEVERITY[env.LOG_LEVEL]) return

  const context = storage.getStore()
  const entry = {
    time: new Date().toISOString(),
    level,
    message,
    ...(context ? { requestId: context.requestId, userId: context.userId } : {}),
    ...fields,
  }

  const line = isProduction ? JSON.stringify(entry) : format(entry, level, message, fields)
  // Ecriture directe plutot que `console` : pas de mise en forme surprise, et
  // les flux restent separes pour la collecte.
  const stream = SEVERITY[level] >= SEVERITY.warn ? process.stderr : process.stdout
  stream.write(`${line}\n`)
}

function format(entry: LogFields, level: LogLevel, message: string, fields: LogFields): string {
  const id = typeof entry.requestId === 'string' ? ` [${entry.requestId.slice(0, 8)}]` : ''
  const rest = Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ')
  return `${level.toUpperCase().padEnd(5)}${id} ${message}${rest ? ` ${rest}` : ''}`
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit('debug', message, fields),
  info: (message: string, fields?: LogFields) => emit('info', message, fields),
  warn: (message: string, fields?: LogFields) => emit('warn', message, fields),
  error: (message: string, fields?: LogFields) => emit('error', message, fields),
}
