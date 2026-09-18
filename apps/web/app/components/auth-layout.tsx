import type { ReactNode } from 'react'
import { Link } from 'react-router'

interface AuthLayoutProps {
  title: string
  subtitle: ReactNode
  children: ReactNode
}

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-8 px-4 py-12">
      <div className="flex flex-col gap-3">
        <Link
          to="/"
          className="font-mono text-xs uppercase tracking-[0.3em] text-brand hover:underline"
        >
          STEMLAB
        </Link>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {children}
    </main>
  )
}
