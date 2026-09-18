import * as Sentry from '@sentry/node'
import { env, isProduction } from '~/lib/env.server'
import { currentRequestContext, logger } from '~/lib/logger.server'

/**
 * Remontee des erreurs.
 *
 * Sans DSN, rien n'est envoye et la fonction reste sans effet : le
 * developpement et les tests n'ont pas a joindre un service tiers pour que
 * l'application fonctionne, et une cle absente ne doit pas faire echouer un
 * demarrage.
 *
 * L'instrumentation automatique du SDK n'est pas activee : elle exige d'etre
 * chargee avant tout le reste, ce que le serveur de React Router ne permet pas
 * sans reecrire son point d'entree. Les erreurs sont donc signalees
 * explicitement, la ou on les traite deja.
 */

let started = false

export function startMonitoring(): void {
  if (started || !env.SENTRY_DSN) return
  started = true

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // Aucun echantillonnage de traces : on veut les erreurs, pas un profil.
    tracesSampleRate: 0,
    // Les URL presignees contiennent une signature ; les corps de requete
    // peuvent contenir une adresse electronique. Ni l'un ni l'autre n'a sa
    // place dans un service tiers.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.query_string) delete event.request.query_string
      return event
    },
  })

  logger.info('remontee des erreurs active', { environment: env.NODE_ENV })
}

export function reportError(error: unknown, fields: Record<string, unknown> = {}): void {
  if (!env.SENTRY_DSN) return
  startMonitoring()

  const context = currentRequestContext()
  Sentry.captureException(error, {
    tags: { requestId: context?.requestId, path: context?.path },
    user: context?.userId ? { id: context.userId } : undefined,
    extra: fields,
  })
}

/** Vrai quand la remontee est configuree — sert a l'exposer dans `/health`. */
export function monitoringEnabled(): boolean {
  return Boolean(env.SENTRY_DSN) && (isProduction || started)
}
