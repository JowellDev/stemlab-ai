import type { MultitrackPlayer } from '@stemlab/audio-engine'
import { type Lyrics, availableLanguages, lineAt } from '@stemlab/contracts'
import { Button, cn } from '@stemlab/ui'
import { Languages } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { usePositionFollower } from '~/hooks/use-position-follower'

const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'Francais',
  en: 'Anglais',
  es: 'Espagnol',
  de: 'Allemand',
  it: 'Italien',
  pt: 'Portugais',
}

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase()
}

interface LyricsPanelProps {
  player: MultitrackPlayer | null
  lyrics: Lyrics
}

/**
 * Paroles qui defilent, avec traduction.
 *
 * La ligne active est suivie par le meme mecanisme que la grille d'accords : la
 * recherche tourne a chaque frame, mais rien n'est notifie tant que la ligne ne
 * change pas. Une ligne dure plusieurs secondes — notifier chaque frame ferait
 * trois cents rendus pour rien.
 *
 * Cliquer une ligne deplace la lecture a son debut, comme un accord.
 */
export function LyricsPanel({ player, lyrics }: LyricsPanelProps) {
  const languages = useMemo(() => availableLanguages(lyrics), [lyrics])
  const [secondary, setSecondary] = useState<string | null>(null)
  const [active, setActive] = useState(-1)
  const listRef = useRef<HTMLOListElement>(null)

  const findIndex = useCallback((position: number) => lineAt(lyrics.lines, position), [lyrics.lines])

  const onChange = useCallback((index: number) => {
    setActive(index)

    // Le defilement suit la ligne active sans jamais voler le focus : l'ancrage
    // au centre garde le contexte visible de part et d'autre.
    const node = listRef.current?.children[index]
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  usePositionFollower(player, findIndex, onChange)

  const alternatives = languages.filter((code) => code !== lyrics.language)

  return (
    <section className="flex flex-col gap-3" aria-label="Paroles">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">
          Paroles
          {lyrics.language ? (
            <span className="text-muted-foreground ml-2 text-xs uppercase tracking-wide">
              {languageName(lyrics.language)}
            </span>
          ) : null}
        </h2>

        {alternatives.length > 0 ? (
          <div className="flex items-center gap-1" role="group" aria-label="Traduction">
            <Languages aria-hidden className="text-muted-foreground mr-1 size-4" />
            <Button
              type="button"
              size="sm"
              variant={secondary === null ? 'secondary' : 'ghost'}
              aria-pressed={secondary === null}
              onClick={() => setSecondary(null)}
            >
              Aucune
            </Button>
            {alternatives.map((code) => (
              <Button
                key={code}
                type="button"
                size="sm"
                variant={secondary === code ? 'secondary' : 'ghost'}
                aria-pressed={secondary === code}
                onClick={() => setSecondary(code)}
              >
                {languageName(code)}
              </Button>
            ))}
          </div>
        ) : null}
      </header>

      <ol
        ref={listRef}
        data-testid="lyrics-lines"
        className="border-input bg-card flex max-h-80 flex-col gap-1 overflow-y-auto rounded-xl border p-3"
      >
        {lyrics.lines.map((line, index) => {
          const current = index === active
          const translation = secondary ? lyrics.translations[secondary]?.[index] : undefined

          return (
            <li key={`${line.start}-${index}`}>
              <button
                type="button"
                data-active={current || undefined}
                aria-current={current ? 'true' : undefined}
                onClick={() => player?.seek(line.start)}
                className={cn(
                  'w-full rounded-lg px-3 py-2 text-left transition-colors',
                  'hover:bg-muted focus-visible:ring-brand focus-visible:ring-2 focus-visible:outline-none',
                  current ? 'bg-muted' : null,
                )}
              >
                <span className={cn('block', current ? 'text-brand font-medium' : null)}>
                  {line.text}
                </span>
                {translation ? (
                  <span className="text-muted-foreground mt-0.5 block text-sm italic">
                    {translation}
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
