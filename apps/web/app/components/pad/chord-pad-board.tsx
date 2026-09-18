import { VOICES } from '@stemlab/audio-engine'
import {
  type ChordColour,
  type ChordFunction,
  type DiatonicChord,
  type Mode,
  diatonicChords,
  pitchClassName,
} from '@stemlab/music'
import { Alert, AlertDescription, Button, Progress, Slider, cn } from '@stemlab/ui'
import { Download, Upload, Volume2, VolumeX, Waves } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useChordPad, type PadSource } from '~/hooks/use-chord-pad'
import { PAD_PROGRAMS } from '~/lib/pad-programs'

/**
 * Pad d'accords tenus.
 *
 * Pense pour etre joue d'une main pendant qu'on fait autre chose de l'autre :
 * une tonalite, une grille, et plus rien a decider en cours de route. Les
 * accords sont ceux de la tonalite choisie — c'est ce qui rend la grille lisible
 * sans y penser, et ce qui evite de chercher un accord au milieu d'un chant.
 *
 * La grille occupe la place ; les reglages se rangent a cote sur grand ecran, et
 * dessous sur telephone. On ne descend pas dans une page pour changer d'accord.
 */

const ROOTS = Array.from({ length: 12 }, (_, index) => index)

const COLOURS: Array<{ id: ChordColour; label: string; hint: string }> = [
  { id: 'triad', label: 'Triade', hint: 'Accord parfait, sans couleur ajoutee' },
  { id: 'sus4', label: 'sus4', hint: 'La tierce laisse place a la quarte : suspendu' },
  { id: 'sus2', label: 'sus2', hint: 'La tierce laisse place a la seconde : ouvert' },
  { id: 'add9', label: 'add9', hint: 'Une neuvieme ajoutee : plus large' },
  { id: 'seventh', label: '7e', hint: 'Septiemes diatoniques : plus dense' },
]

/**
 * Couleur par fonction tonale.
 *
 * Quatre familles plutot que huit teintes : la grille se lit d'un coup d'oeil —
 * ou l'on est pose, ou l'on s'eloigne, ou l'on appelle la resolution.
 */
const FUNCTION_STYLES: Record<ChordFunction, { idle: string; active: string; dot: string }> = {
  tonic: {
    idle: 'border-emerald-500/25 bg-gradient-to-b from-emerald-500/15 to-emerald-500/5 hover:from-emerald-500/25 hover:to-emerald-500/10',
    active:
      'border-emerald-400/80 bg-gradient-to-b from-emerald-500/40 to-emerald-500/15 ring-emerald-400/40',
    dot: 'bg-emerald-400',
  },
  subdominant: {
    idle: 'border-sky-500/25 bg-gradient-to-b from-sky-500/15 to-sky-500/5 hover:from-sky-500/25 hover:to-sky-500/10',
    active: 'border-sky-400/80 bg-gradient-to-b from-sky-500/40 to-sky-500/15 ring-sky-400/40',
    dot: 'bg-sky-400',
  },
  dominant: {
    idle: 'border-amber-500/25 bg-gradient-to-b from-amber-500/15 to-amber-500/5 hover:from-amber-500/25 hover:to-amber-500/10',
    active: 'border-amber-400/80 bg-gradient-to-b from-amber-500/40 to-amber-500/15 ring-amber-400/40',
    dot: 'bg-amber-400',
  },
  colour: {
    idle: 'border-violet-500/25 bg-gradient-to-b from-violet-500/15 to-violet-500/5 hover:from-violet-500/25 hover:to-violet-500/10',
    active:
      'border-violet-400/80 bg-gradient-to-b from-violet-500/40 to-violet-500/15 ring-violet-400/40',
    dot: 'bg-violet-400',
  },
}

const FUNCTION_NAMES: Record<ChordFunction, string> = {
  tonic: 'Repos',
  subdominant: 'Depart',
  dominant: 'Tension',
  colour: 'Couleur',
}

export function ChordPadBoard() {
  const [root, setRoot] = useState(0)
  const [mode, setMode] = useState<Mode>('major')
  const [colour, setColour] = useState<ChordColour>('triad')
  const [voice, setVoice] = useState(VOICES[0]!.id)
  const [volume, setVolume] = useState(0.7)
  const [smoothness, setSmoothness] = useState(1)
  const [octave, setOctave] = useState(4)
  const [source, setSource] = useState<PadSource>('synth')
  const [program, setProgram] = useState(PAD_PROGRAMS[0]!.value)
  const fileRef = useRef<HTMLInputElement>(null)

  const pad = useChordPad({ source, voice, volume, smoothness, octave, program })
  const bank = pad.bank
  const sampled = source === 'soundfont'

  async function chooseSource(next: PadSource) {
    setSource(next)
    // La banque ne se telecharge qu'au moment ou l'on en a besoin : le pad
    // synthetise, lui, n'a besoin de rien.
    if (next === 'soundfont' && bank.state !== 'ready') await pad.loadBank()
  }
  const chords = useMemo(() => diatonicChords(root, mode, colour), [root, mode, colour])
  const accidental = mode === 'minor' ? 'flat' : 'sharp'
  const keyName = `${pitchClassName(root, accidental)} ${mode === 'major' ? 'majeur' : 'mineur'}`
  const selectedVoice = VOICES.find((entry) => entry.id === voice) ?? VOICES[0]!

  return (
    <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8">
      {/* --- la grille, et ce qui la definit -------------------------------- */}
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2.5" aria-label="Tonalite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5" role="group" aria-label="Mode">
              {(['major', 'minor'] as const).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={mode === value ? 'secondary' : 'ghost'}
                  aria-pressed={mode === value}
                  onClick={() => setMode(value)}
                >
                  {value === 'major' ? 'Majeur' : 'Mineur'}
                </Button>
              ))}
            </div>
            <p className="text-muted-foreground text-sm" data-testid="pad-key">
              {keyName}
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Fondamentale">
            {ROOTS.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={value === root}
                onClick={() => setRoot(value)}
                className={cn(
                  'min-w-10 rounded-lg border px-2 py-1.5 text-sm font-medium transition-colors',
                  'focus-visible:ring-brand focus-visible:ring-2 focus-visible:outline-none',
                  value === root
                    ? 'border-brand bg-brand/20 text-foreground'
                    : 'border-input bg-card text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {pitchClassName(value, accidental)}
              </button>
            ))}
          </div>
        </section>

        <ul data-testid="pad-grid" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {chords.map((chord) => (
            <ChordButton
              key={`${chord.degree}-${chord.label}`}
              chord={chord}
              active={pad.active === chord.label}
              onPlay={() => pad.play(chord)}
            />
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <ul className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
            {(Object.keys(FUNCTION_NAMES) as ChordFunction[]).map((fonction) => (
              <li key={fonction} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn('size-2 rounded-full', FUNCTION_STYLES[fonction].dot)}
                />
                {FUNCTION_NAMES[fonction]}
              </li>
            ))}
          </ul>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pad.active === null}
            onClick={pad.stop}
          >
            <VolumeX aria-hidden className="size-4" />
            Laisser mourir
          </Button>
        </div>

        <section className="flex flex-wrap items-center gap-1.5" aria-label="Couleur des accords">
          <span className="text-muted-foreground mr-1 text-xs font-medium tracking-wide uppercase">
            Couleur
          </span>
          {COLOURS.map((entry) => (
            <Button
              key={entry.id}
              type="button"
              size="sm"
              title={entry.hint}
              variant={colour === entry.id ? 'secondary' : 'ghost'}
              aria-pressed={colour === entry.id}
              onClick={() => setColour(entry.id)}
            >
              {entry.label}
            </Button>
          ))}
        </section>
      </div>

      {/* --- reglages du son ------------------------------------------------ */}
      <aside className="border-input bg-card flex flex-col gap-5 rounded-xl border p-4">
        <section className="flex flex-col gap-2" aria-label="Source sonore">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Source
          </h2>

          <div className="flex gap-1.5" role="group" aria-label="Source sonore">
            <Button
              type="button"
              size="sm"
              variant={!sampled ? 'secondary' : 'ghost'}
              aria-pressed={!sampled}
              onClick={() => void chooseSource('synth')}
            >
              Synthese
            </Button>
            <Button
              type="button"
              size="sm"
              variant={sampled ? 'secondary' : 'ghost'}
              aria-pressed={sampled}
              onClick={() => void chooseSource('soundfont')}
            >
              Echantillons
            </Button>
          </div>

          {sampled ? (
            <div className="flex flex-col gap-2" data-testid="pad-bank">
              {bank.state === 'loading' ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <Download aria-hidden className="size-3.5" />
                    Telechargement de la banque…
                  </p>
                  <Progress
                    value={
                      bank.progress?.total
                        ? (bank.progress.loaded / bank.progress.total) * 100
                        : undefined
                    }
                    aria-label="Telechargement de la banque d echantillons"
                    className="h-1.5"
                  />
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {((bank.progress?.loaded ?? 0) / 1e6).toFixed(1)} Mo
                    {bank.progress?.total ? ` / ${(bank.progress.total / 1e6).toFixed(1)} Mo` : ''}
                  </p>
                </div>
              ) : null}

              {bank.error ? (
                <Alert variant="destructive">
                  <AlertDescription className="text-xs">{bank.error}</AlertDescription>
                </Alert>
              ) : null}

              {bank.state === 'ready' ? (
                <>
                  <label className="text-muted-foreground text-xs" htmlFor="pad-program">
                    Instrument
                  </label>
                  <select
                    id="pad-program"
                    value={program}
                    onChange={(event) => setProgram(Number(event.target.value))}
                    className="border-input bg-card focus-visible:ring-brand rounded-lg border px-2.5 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {PAD_PROGRAMS.map((entry) => (
                      <option key={entry.value} value={entry.value} title={entry.hint}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}

              {/* Une banque personnelle remplace celle fournie : c'est le seul
                  moyen d'avoir d'autres sons que ceux de la norme General MIDI. */}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="justify-start"
                onClick={() => fileRef.current?.click()}
              >
                <Upload aria-hidden className="size-4" />
                Charger ma banque (.sf2, .sf3)
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".sf2,.sf3,.dls"
                aria-label="Banque d echantillons personnelle"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void pad.loadBank(file)
                  event.target.value = ''
                }}
              />
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-2" aria-label="Timbre">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {sampled ? 'Ambiance' : 'Timbre'}
          </h2>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choix du timbre">
            {VOICES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={voice === entry.id}
                onClick={() => setVoice(entry.id)}
                className={cn(
                  'rounded-lg border px-2.5 py-1.5 text-sm transition-colors',
                  'focus-visible:ring-brand focus-visible:ring-2 focus-visible:outline-none',
                  voice === entry.id
                    ? 'border-brand bg-brand/20 text-foreground'
                    : 'border-input text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {entry.name}
              </button>
            ))}
          </div>

          {/* La description du timbre choisi, plutot que les huit a la fois : on
              lit ce qu'on a sous la main, pas un catalogue. */}
          <p className="text-muted-foreground text-xs leading-relaxed" data-testid="pad-voice-hint">
            {sampled
              ? `Salle et echo empruntes a « ${selectedVoice.name} ». Les sons, eux, viennent de la banque.`
              : selectedVoice.description}
          </p>
        </section>

        <section className="flex flex-col gap-4" aria-label="Reglages du son">
          <Control icon={<Volume2 aria-hidden className="size-3.5" />} label="Volume">
            <Slider
              value={[volume]}
              min={0}
              max={1}
              step={0.01}
              thumbLabel="Volume"
              onValueChange={([next]) => setVolume(next ?? volume)}
            />
          </Control>

          <Control icon={<Waves aria-hidden className="size-3.5" />} label="Douceur">
            <Slider
              value={[smoothness]}
              min={0.4}
              max={2.5}
              step={0.05}
              disabled={sampled}
              thumbLabel="Douceur du fondu"
              onValueChange={([next]) => setSmoothness(next ?? smoothness)}
            />
            {sampled ? (
              <p className="text-muted-foreground text-xs">
                Les fondus viennent de la banque : ce reglage ne s applique qu a la synthese.
              </p>
            ) : null}
          </Control>

          <Control label="Registre">
            <div className="flex gap-1.5" role="group" aria-label="Octave">
              {[3, 4, 5].map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={octave === value ? 'secondary' : 'ghost'}
                  aria-pressed={octave === value}
                  onClick={() => setOctave(value)}
                >
                  {value === 3 ? 'Grave' : value === 4 ? 'Medium' : 'Aigu'}
                </Button>
              ))}
            </div>
          </Control>
        </section>
      </aside>
    </div>
  )
}

function ChordButton({
  chord,
  active,
  onPlay,
}: {
  chord: DiatonicChord
  active: boolean
  onPlay: () => void
}) {
  const style = FUNCTION_STYLES[chord.function]

  return (
    <li>
      <button
        type="button"
        data-active={active || undefined}
        aria-pressed={active}
        onClick={onPlay}
        className={cn(
          'flex min-h-28 w-full flex-col items-center justify-center gap-0.5 rounded-xl border lg:min-h-36',
          'transition-all duration-300 active:scale-[0.98]',
          'focus-visible:ring-brand focus-visible:ring-2 focus-visible:outline-none',
          active ? cn(style.active, 'animate-breathe ring-2') : style.idle,
        )}
      >
        <span className="text-2xl font-semibold tracking-tight lg:text-3xl">{chord.label}</span>
        <span
          className={cn(
            'text-xs tabular-nums transition-colors',
            active ? 'text-foreground/70' : 'text-muted-foreground',
          )}
        >
          {chord.degree}
        </span>
      </button>
    </li>
  )
}

function Control({
  icon,
  label,
  children,
}: {
  icon?: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
        {icon}
        {label}
      </p>
      {children}
    </div>
  )
}
