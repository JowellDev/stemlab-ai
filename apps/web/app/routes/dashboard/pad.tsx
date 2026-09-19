import { AppShell } from '~/components/app-shell'
import { ChordPadBoard } from '~/components/pad/chord-pad-board'
import { requireUser } from '~/lib/session.server'
import type { Route } from './+types/pad'

/**
 * Pad d'accords tenus.
 *
 * Page autonome : elle ne depend d'aucun morceau, et sert pendant un temps de
 * louange ou une repetition. Tout est synthetise dans le navigateur — rien a
 * telecharger, et le pad fonctionne hors connexion.
 */
export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Pad d’accords — STEMLAB' },
    {
      name: 'description',
      content: 'Nappes tenues, accords de la tonalite choisie, pour accompagner un temps de chant.',
    },
    { name: 'robots', content: 'noindex' },
  ]
}

export async function loader({ request }: Route.LoaderArgs) {
  return { user: await requireUser(request) }
}

export default function Pad({ loaderData }: Route.ComponentProps) {
  return (
    <AppShell user={loaderData.user}>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Pad d&apos;accords</h1>
          <p className="text-muted-foreground text-sm">
            Choisissez une tonalite, puis touchez un accord : il se tient jusqu&apos;au suivant.
          </p>
        </header>

        <ChordPadBoard />
      </main>
    </AppShell>
  )
}
