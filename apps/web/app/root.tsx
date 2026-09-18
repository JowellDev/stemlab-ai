import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteLoaderData,
} from 'react-router'
import { useEffect } from 'react'
import { registerServiceWorker } from '~/lib/register-sw.client'
import { currentNonce, observability } from '~/lib/middleware.server'
import type { Route } from './+types/root'
import './app.css'

export const links: Route.LinksFunction = () => [
  // Inter est servie par l'application : voir la declaration dans `app.css`.
  {
    rel: 'preload',
    href: '/fonts/inter-latin.woff2',
    as: 'font',
    type: 'font/woff2',
    crossOrigin: 'anonymous',
  },
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
]

/**
 * Traversee appliquee a toutes les requetes : identifiant, journal, en-tetes de
 * securite. Declaree sur la racine, elle couvre l'ensemble de l'arbre.
 */
export const middleware: Route.MiddlewareFunction[] = [observability]

/**
 * Le nonce voyage par les donnees de la racine.
 *
 * Il doit etre identique dans l'en-tete et dans les balises `<script>` : le
 * transmettre par le chargeur est le seul moyen pour que le serveur et le
 * client s'accordent, et donc que l'hydratation ne le voie pas changer.
 */
export function loader(_args: Route.LoaderArgs) {
  return { nonce: currentNonce() ?? null }
}

export function Layout({ children }: { children: React.ReactNode }) {
  // `Layout` habille aussi la frontiere d'erreur, ou les donnees de la racine
  // peuvent manquer : le nonce est alors vide, et la page reste lisible sans script.
  const nonce = useRouteLoaderData<typeof loader>('root')?.nonce ?? undefined

  return (
    <html lang="fr" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#14181f" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="STEMLAB" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh">
        {children}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  )
}

export default function App() {
  // L'enregistrement vit ici plutot que dans le document : il ne doit avoir lieu
  // que cote client, et une seule fois pour toute la session.
  useEffect(() => {
    void registerServiceWorker()
  }, [])

  // Signale que React a pris la main. Le HTML rendu par le serveur est complet
  // et cliquable avant l'hydratation, mais ses gestionnaires n'existent pas
  // encore : un `change` emis trop tot — un fichier depose, par exemple — est
  // perdu sans rien laisser paraitre. Les tests attendent ce marqueur.
  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true'
  }, [])

  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = 'Une erreur est survenue'
  let detail = 'Reessayez dans un instant.'
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? 'Page introuvable' : `Erreur ${error.status}`
    detail = error.statusText || detail
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message
    stack = error.stack
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{detail}</p>
      {stack ? (
        <pre className="overflow-x-auto rounded-lg bg-card p-4 text-xs text-muted-foreground">
          <code>{stack}</code>
        </pre>
      ) : null}
      <a className="text-brand underline underline-offset-4" href="/">
        Retour a l&apos;accueil
      </a>
    </main>
  )
}
