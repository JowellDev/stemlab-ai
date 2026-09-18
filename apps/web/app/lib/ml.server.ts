import {
  CreateJobRequest,
  CreateJobResponse,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  StemlabError,
  signBody,
} from '@stemlab/contracts'
import { env } from './env.server'

/**
 * Client du service ML.
 *
 * Toutes les requetes sont signees avec le meme secret partage que le webhook de
 * retour : le canal est symetrique, et le service ML n'est jamais joignable
 * autrement que par le BFF.
 */

const REQUEST_TIMEOUT_MS = 10_000

export async function createJob(input: CreateJobRequest): Promise<CreateJobResponse> {
  const payload = CreateJobRequest.parse(input)
  const body = JSON.stringify(payload)
  const { signature, timestamp } = await signBody(
    env.ML_WEBHOOK_SECRET,
    body,
    Math.floor(Date.now() / 1000),
  )

  let response: Response
  try {
    response = await fetch(new URL('/jobs', env.ML_API_URL), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADER]: signature,
        [TIMESTAMP_HEADER]: String(timestamp),
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (cause) {
    throw new StemlabError(
      'upstream_unavailable',
      "Le service d'analyse est injoignable. Reessayez dans un instant.",
      { cause: [cause instanceof Error ? cause.message : String(cause)] },
    )
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new StemlabError(
      response.status >= 500 ? 'upstream_unavailable' : 'bad_request',
      `Le service d'analyse a refuse la demande (HTTP ${response.status}).`,
      detail ? { upstream: [detail.slice(0, 500)] } : undefined,
    )
  }

  return CreateJobResponse.parse(await response.json())
}
