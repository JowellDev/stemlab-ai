import { Links, Meta, Outlet, Scripts, ScrollRestoration, isRouteErrorResponse } from 'react-router'
import type { Route } from './+types/root'
import './app.css'

export const links: Route.LinksFunction = () => [
  { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
  { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
  {
    rel: 'stylesheet',
    href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  },
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
]

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#14181f" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
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
