import { db } from '~/lib/db.server'

/**
 * Metriques au format texte de Prometheus.
 *
 * Un registre maison plutot qu'une bibliotheque : on expose une dizaine de
 * series, toutes cumulatives, et le format tient en vingt lignes. Y ajouter une
 * dependance qui instrumente le processus entier couterait plus que ce qu'elle
 * rapporterait.
 *
 * Les compteurs sont par instance et repartent a zero au redemarrage : c'est le
 * contrat d'un compteur Prometheus, et la fonction `rate()` s'en accommode.
 */

const requests = new Map<string, number>()
const durations = { count: 0, sumSeconds: 0 }
const startedAt = Date.now()

export function recordRequest(method: string, status: number, durationMs: number): void {
  const key = `${method}:${statusClass(status)}`
  requests.set(key, (requests.get(key) ?? 0) + 1)
  durations.count += 1
  durations.sumSeconds += durationMs / 1000
}

/** `2xx`, `4xx`… : garder le code exact ferait exploser le nombre de series. */
function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`
}

export async function renderMetrics(): Promise<string> {
  const [users, tracksByStatus] = await Promise.all([
    db.user.count(),
    db.track.groupBy({ by: ['status'], _count: { _all: true } }),
  ])

  const lines: string[] = []

  lines.push(
    '# HELP stemlab_http_requests_total Requetes traitees, par methode et classe de code.',
    '# TYPE stemlab_http_requests_total counter',
  )
  for (const [key, count] of requests) {
    const [method, status] = key.split(':')
    lines.push(`stemlab_http_requests_total{method="${method}",status="${status}"} ${count}`)
  }

  lines.push(
    '# HELP stemlab_http_request_duration_seconds_sum Temps cumule de traitement.',
    '# TYPE stemlab_http_request_duration_seconds_sum counter',
    `stemlab_http_request_duration_seconds_sum ${durations.sumSeconds.toFixed(3)}`,
    '# HELP stemlab_http_request_duration_seconds_count Requetes mesurees.',
    '# TYPE stemlab_http_request_duration_seconds_count counter',
    `stemlab_http_request_duration_seconds_count ${durations.count}`,
  )

  lines.push(
    '# HELP stemlab_users_total Comptes existants.',
    '# TYPE stemlab_users_total gauge',
    `stemlab_users_total ${users}`,
  )

  lines.push(
    '# HELP stemlab_tracks_total Morceaux, par etat.',
    '# TYPE stemlab_tracks_total gauge',
  )
  for (const row of tracksByStatus) {
    lines.push(`stemlab_tracks_total{status="${row.status}"} ${row._count._all}`)
  }

  const memory = process.memoryUsage()
  lines.push(
    '# HELP stemlab_process_uptime_seconds Duree depuis le demarrage de l instance.',
    '# TYPE stemlab_process_uptime_seconds gauge',
    `stemlab_process_uptime_seconds ${((Date.now() - startedAt) / 1000).toFixed(0)}`,
    '# HELP stemlab_process_resident_memory_bytes Memoire residente du processus.',
    '# TYPE stemlab_process_resident_memory_bytes gauge',
    `stemlab_process_resident_memory_bytes ${memory.rss}`,
  )

  return `${lines.join('\n')}\n`
}
