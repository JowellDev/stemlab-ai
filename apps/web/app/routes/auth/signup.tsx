import { Alert, AlertDescription, Button, Field } from '@stemlab/ui'
import { Form, Link, redirect, useNavigation, useSearchParams } from 'react-router'
import { z } from 'zod'
import { AuthLayout } from '~/components/auth-layout'
import { signUpWithEmail } from '~/lib/auth-forms.server'
import { hasGoogleOAuth } from '~/lib/env.server'
import { safeRedirect } from '~/lib/redirect.server'
import { getUser } from '~/lib/session.server'
import { signIn } from '~/lib/auth-client'
import type { Route } from './+types/signup'

const MIN_PASSWORD_LENGTH = 10

const SignUpForm = z.object({
  name: z.string().trim().min(1, 'Indiquez un nom').max(100),
  email: z.email('Adresse electronique invalide'),
  password: z.string().min(MIN_PASSWORD_LENGTH, `Au moins ${MIN_PASSWORD_LENGTH} caracteres`),
})

/** Erreurs par champ, indexees par le nom du champ du formulaire. */
type FieldErrors = Partial<Record<'name' | 'email' | 'password', string>>

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Creer un compte — STEMLAB' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUser(request)) throw redirect('/library')
  return { googleEnabled: hasGoogleOAuth }
}

/**
 * L'inscription passe par une action serveur plutot que par le client
 * d'authentification : le formulaire fonctionne alors avant l'hydratation, et donc
 * sans JavaScript.
 */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const redirectTo = safeRedirect(form.get('redirectTo'))

  const parsed = SignUpForm.safeParse({
    name: form.get('name'),
    email: form.get('email'),
    password: form.get('password'),
  })

  if (!parsed.success) {
    const errors: FieldErrors = {}
    for (const issue of parsed.error.issues) {
      const field = String(issue.path[0]) as keyof FieldErrors
      errors[field] ??= issue.message
    }
    return { errors, formError: null }
  }

  const outcome = await signUpWithEmail(parsed.data)
  if (!outcome.ok) {
    return { errors: {} as FieldErrors, formError: outcome.message }
  }

  outcome.headers.set('Location', redirectTo)
  return new Response(null, { status: 303, headers: outcome.headers })
}

export default function Inscription({ loaderData, actionData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams()
  const navigation = useNavigation()
  const redirectTo = safeRedirectClient(searchParams.get('redirectTo'))
  const submitting = navigation.formAction === '/signup'

  const errors: FieldErrors = actionData?.errors ?? {}

  return (
    <AuthLayout
      title="Creer un compte"
      subtitle={
        <>
          Deja inscrit ?{' '}
          <Link to="/connexion" className="text-brand underline underline-offset-4">
            Se connecter
          </Link>
        </>
      }
    >
      {actionData?.formError ? (
        <Alert variant="destructive">
          <AlertDescription>{actionData.formError}</AlertDescription>
        </Alert>
      ) : null}

      <Form method="post" className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="redirectTo" value={redirectTo} />

        <Field
          label="Nom"
          name="name"
          autoComplete="name"
          required
          error={errors.name}
          placeholder="Camille Durand"
        />
        <Field
          label="Adresse electronique"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={errors.email}
          placeholder="camille@exemple.fr"
        />
        <Field
          label="Mot de passe"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          error={errors.password}
          hint={`Au moins ${MIN_PASSWORD_LENGTH} caracteres.`}
        />

        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? 'Creation en cours…' : 'Creer mon compte'}
        </Button>
      </Form>

      {loaderData.googleEnabled ? (
        <div className="flex flex-col gap-3">
          <p className="text-center text-xs uppercase tracking-widest text-muted-foreground/70">
            ou
          </p>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={() => signIn.social({ provider: 'google', callbackURL: redirectTo })}
          >
            Continuer avec Google
          </Button>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Vos fichiers restent prives. STEMLAB est destine a un usage strictement personnel.
      </p>
    </AuthLayout>
  )
}

/** Meme regle que cote serveur : un `redirectTo` externe ne doit pas etre repris. */
function safeRedirectClient(target: string | null): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
    return '/library'
  }
  return target
}
