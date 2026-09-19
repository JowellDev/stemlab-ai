import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import type { Route } from './+types/legal'

/**
 * Conditions d'utilisation et traitement des donnees.
 *
 * Page publique et sans dependance : elle doit rester lisible meme quand
 * l'utilisateur n'est pas connecte, et c'est vers elle que renvoie toute question
 * sur ce que devient un fichier depose.
 */
export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'Conditions d&apos;utilisation — STEMLAB' },
    {
      name: 'description',
      content: 'Usage strictement personnel, aucun partage public, suppression sur simple demande.',
    },
  ]
}

export default function Legal() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-3">
        <Link
          to="/"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1.5 text-sm transition-colors"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Retour a l&apos;accueil
        </Link>
        <h1 className="text-2xl font-semibold">Conditions d&apos;utilisation</h1>
        <p className="text-muted-foreground text-sm">Derniere mise a jour : 18 septembre 2026.</p>
      </div>

      <Section title="Usage strictement personnel">
        <p>
          STEMLAB est un outil de travail personnel. Vous ne pouvez y deposer que des fichiers dont
          vous detenez les droits, ou dont l&apos;usage vous est legalement permis — un morceau que
          vous avez achete, enregistre ou compose.
        </p>
        <p>
          Les pistes separees, l&apos;analyse harmonique et les paroles transcrites sont destinees a
          votre propre pratique : repetition, transcription, etude. Les redistribuer, les publier ou
          les exploiter commercialement vous appartient, et releve de votre responsabilite au regard
          des droits attaches a l&apos;œuvre d&apos;origine.
        </p>
      </Section>

      <Section title="Aucun partage public">
        <p>
          Vos fichiers restent prives. Le service ne comporte{' '}
          <strong>ni partage public, ni catalogue, ni bibliotheque commune</strong> : aucun autre
          utilisateur ne peut voir, chercher ou telecharger ce que vous deposez.
        </p>
        <p>
          Les adresses de telechargement sont signees et expirent au bout de quelques minutes. Une
          adresse copiee puis transmise cesse de fonctionner d&apos;elle-meme.
        </p>
      </Section>

      <Section title="Ce qui est conserve">
        <ul className="list-disc space-y-1 pl-5">
          <li>le fichier d&apos;origine que vous avez depose ;</li>
          <li>les pistes separees et les formes d&apos;onde calculees ;</li>
          <li>la tonalite, le tempo, la grille de mesures et les accords detectes ;</li>
          <li>les paroles transcrites et leurs traductions, quand il y en a ;</li>
          <li>votre adresse electronique et votre nom, pour l&apos;authentification.</li>
        </ul>
        <p>
          Rien d&apos;autre. Aucun suivi publicitaire, aucun traceur tiers, aucune revente de
          donnees.
        </p>
      </Section>

      <Section title="Suppression">
        <p>
          Supprimer un morceau depuis votre bibliotheque efface immediatement le fichier
          d&apos;origine, ses pistes et son analyse. L&apos;operation est definitive.
        </p>
        <p>
          Pour la suppression de l&apos;integralite de votre compte et de tout ce qui s&apos;y
          rattache, la demande suffit : elle est traitee sous trente jours, sans justification a
          fournir. Les objets restes sans rattachement sont reclames automatiquement.
        </p>
      </Section>

      <Section title="Traitement automatise">
        <p>
          La separation des pistes et la transcription des paroles sont effectuees par des modeles
          d&apos;apprentissage automatique executes sur notre infrastructure. Vos fichiers ne sont
          envoyes a aucun service tiers, et ne servent a entrainer aucun modele.
        </p>
      </Section>

      <Section title="Absence de garantie">
        <p>
          La separation des pistes, la detection d&apos;accords et la transcription sont des
          estimations. Elles se trompent — d&apos;autant plus sur les enregistrements denses, les
          voix noyees dans le mixage ou les harmonies ambigues. Le service est fourni en
          l&apos;etat, sans garantie d&apos;exactitude.
        </p>
      </Section>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">{title}</h2>
      <div className="text-muted-foreground flex flex-col gap-2 text-sm leading-relaxed">
        {children}
      </div>
    </section>
  )
}
