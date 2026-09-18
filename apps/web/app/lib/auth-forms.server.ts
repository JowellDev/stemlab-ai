import { auth } from './auth.server'

/**
 * Appels d'authentification cote serveur.
 *
 * Passer par les actions plutot que par le client permet a l'inscription et a la
 * connexion de fonctionner avant l'hydratation — et donc sans JavaScript. Les
 * cookies de session sont recopies tels quels sur la redirection.
 */

export type AuthOutcome =
  { ok: true; headers: Headers } | { ok: false; status: number; message: string }

async function run(
  call: () => Promise<Response>,
  onError: (status: number, body: unknown) => string,
): Promise<AuthOutcome> {
  let response: Response
  try {
    response = await call()
  } catch (error) {
    // better-auth leve une APIError porteuse d'une reponse quand l'appel echoue.
    const candidate = (error as { response?: unknown })?.response
    if (!(candidate instanceof Response)) {
      console.error('authentification', error)
      return { ok: false, status: 500, message: 'Une erreur interne est survenue.' }
    }
    response = candidate
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    return { ok: false, status: response.status, message: onError(response.status, body) }
  }

  const headers = new Headers()
  for (const cookie of response.headers.getSetCookie()) {
    headers.append('Set-Cookie', cookie)
  }
  return { ok: true, headers }
}

export function signUpWithEmail(input: {
  name: string
  email: string
  password: string
}): Promise<AuthOutcome> {
  return run(
    () => auth.api.signUpEmail({ body: input, asResponse: true }),
    (status) =>
      status === 422 || status === 400
        ? 'Un compte existe deja avec cette adresse.'
        : 'La creation du compte a echoue. Reessayez.',
  )
}

export function signInWithEmail(input: { email: string; password: string }): Promise<AuthOutcome> {
  return run(
    () => auth.api.signInEmail({ body: input, asResponse: true }),
    // Message identique pour un compte inconnu et un mot de passe faux : distinguer
    // les deux revient a divulguer qui possede un compte.
    () => 'Adresse ou mot de passe incorrect.',
  )
}
