import { Alert, AlertDescription, Button, Field } from '@stemlab/ui'
import { Form, Link, redirect, useNavigation, useSearchParams } from 'react-router'
import { z } from 'zod'
import { AuthLayout } from '~/components/auth-layout'
import { signIn } from '~/lib/auth-client'
import { signInWithEmail } from '~/lib/auth-forms.server'
import { hasGoogleOAuth } from '~/lib/env.server'
import { safeRedirect } from '~/lib/redirect.server'
import { getUser } from '~/lib/session.server'
import type { Route } from './+types/login'

const SignInForm = z.object({
  email: z.email('Adresse electronique invalide'),
  password: z.string().min(1, 'Saisissez votre mot de passe'),
})

/** Erreurs par champ, indexees par le nom du champ du formulaire. */
type FieldErrors = Partial<Record<'email' | 'password', string>>

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'Connexion — STEMLAB' }]
}

export async function loader({ request }: Route.LoaderArgs) {
  if (await getUser(request)) throw redirect('/library')
  return { googleEnabled: hasGoogleOAuth }
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const redirectTo = safeRedirect(form.get('redirectTo'))

  const parsed = SignInForm.safeParse({
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

  const outcome = await signInWithEmail(parsed.data)
  if (!outcome.ok) {
    return { errors: {} as FieldErrors, formError: outcome.message }
  }

  outcome.headers.set('Location', redirectTo)
  return new Response(null, { status: 303, headers: outcome.headers })
}

export default function Connexion({ loaderData, actionData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams()
  const navigation = useNavigation()
  const redirectTo = safeRedirectClient(searchParams.get('redirectTo'))
  const submitting = navigation.formAction === '/login'

  const errors: FieldErrors = actionData?.errors ?? {}

  return (
    <AuthLayout
      title="Connexion"
      subtitle={
        <>
          Pas encore de compte ?{' '}
          <Link to="/inscription" className="text-brand underline underline-offset-4">
            En creer un
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
          autoComplete="current-password"
          required
          error={errors.password}
        />

        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? 'Connexion…' : 'Se connecter'}
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
    </AuthLayout>
  )
}

function safeRedirectClient(target: string | null): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
    return '/library'
  }
  return target
}
