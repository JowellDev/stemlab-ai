import { cn } from '@stemlab/ui'
import { OfflineIndicator } from '~/components/offline-indicator'
import { AudioLines, LogOut } from 'lucide-react'
import type { ReactNode } from 'react'
import { Form, Link, NavLink } from 'react-router'
import type { SessionUser } from '~/lib/session.server'

interface AppShellProps {
  user: SessionUser
  children: ReactNode
}

export function AppShell({ user, children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <OfflineIndicator />
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <AudioLines aria-hidden className="size-5 text-brand" />
            <span className="font-mono text-xs uppercase tracking-[0.3em] text-brand">STEMLAB</span>
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            <NavLink
              to="/library"
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-1.5 transition-colors',
                  isActive
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              Ma bibliotheque
            </NavLink>

            <NavLink
              to="/pad"
              className={({ isActive }) =>
                cn(
                  'rounded-md px-3 py-1.5 transition-colors',
                  isActive
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              Pad
            </NavLink>

            <Form method="post" action="/logout">
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <LogOut aria-hidden className="size-4" />
                <span className="hidden sm:inline">Se deconnecter</span>
                <span className="sr-only sm:hidden">Se deconnecter ({user.email})</span>
              </button>
            </Form>
          </nav>
        </div>
      </header>

      {children}

      <footer className="border-border mt-auto border-t">
        <div className="text-muted-foreground mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs sm:px-6">
          <p>Usage strictement personnel. Vos fichiers restent prives.</p>
          <Link to="/legal" className="hover:text-foreground transition-colors">
            Conditions d&apos;utilisation
          </Link>
        </div>
      </footer>
    </div>
  )
}
