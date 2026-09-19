import { Button } from '@stemlab/ui'
import { AudioLines, Music4, SlidersHorizontal } from 'lucide-react'
import { Link } from 'react-router'
import { getUser } from '~/lib/session.server'
import type { Route } from './+types/home'

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request)
  return { signedIn: user !== null }
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'STEMLAB — separation de pistes et analyse musicale' },
    {
      name: 'description',
      content:
        'Separez vos morceaux en pistes isolees, detectez tonalite, tempo et accords, rejouez le tout dans un lecteur multipiste.',
    },
  ]
}

const FEATURES = [
  {
    icon: AudioLines,
    title: 'Separation par IA',
    body: 'Voix, batterie, basse, guitare, piano et le reste, isoles en pistes independantes.',
  },
  {
    icon: Music4,
    title: 'Analyse musicale',
    body: 'Tonalite, tempo, grille de mesures et suite d accords detectes automatiquement.',
  },
  {
    icon: SlidersHorizontal,
    title: 'Lecteur multipiste',
    body: 'Mute, solo, volume par piste, tempo et tonalite modifiables independamment.',
  },
]

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-16 px-4 py-16 sm:px-6">
      <header className="flex flex-col gap-6">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-brand">STEMLAB</p>
        <h1 className="text-balance text-4xl font-semibold leading-tight sm:text-5xl">
          Decomposez un morceau. Comprenez-le. Rejouez-le.
        </h1>
        <p className="max-w-2xl text-pretty text-lg text-muted-foreground">
          Deposez un fichier audio : STEMLAB en extrait les pistes instrumentales et vocales,
          detecte la tonalite, le tempo et les accords, puis vous rend la main dans un lecteur
          multipiste synchronise.
        </p>

        <div className="flex flex-wrap gap-3">
          {loaderData.signedIn ? (
            <Button asChild size="lg">
              <Link to="/library">Ouvrir ma bibliotheque</Link>
            </Button>
          ) : (
            <>
              <Button asChild size="lg">
                <Link to="/signup">Creer un compte</Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link to="/login">Se connecter</Link>
              </Button>
            </>
          )}
        </div>
      </header>

      <ul className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <li
            key={title}
            className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
          >
            <Icon aria-hidden className="size-5 text-brand" />
            <h2 className="font-medium">{title}</h2>
            <p className="text-sm text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>

      <footer className="mt-auto text-sm text-muted-foreground">
        Usage strictement personnel. Vos fichiers restent prives.
      </footer>
    </main>
  )
}
