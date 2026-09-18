import { Alert, AlertDescription, Button, Progress, cn } from '@stemlab/ui'
import { CloudUpload, Loader2, Upload, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useUploadQueue } from '~/hooks/use-upload-queue'
import {
  ACCEPTED_TYPES,
  type UploadPhase,
  UploadError,
  describeFileError,
  formatBytes,
  uploadTrack,
} from '~/lib/upload.client'

const PHASE_LABELS: Record<UploadPhase, string> = {
  hashing: 'Lecture du fichier',
  preparing: 'Preparation',
  uploading: 'Envoi',
  finishing: 'Mise en file',
  done: 'Termine',
}

interface UploadDropzoneProps {
  onUploaded: () => void
}

export function UploadDropzone({ onUploaded }: UploadDropzoneProps) {
  const queue = useUploadQueue(onUploaded)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<UploadPhase | null>(null)
  const [percent, setPercent] = useState(0)
  const [filename, setFilename] = useState<string | null>(null)

  const busy = phase !== null && phase !== 'done'

  const defer = useCallback(
    async (file: File) => {
      try {
        await queue.enqueue(file)
      } catch (cause) {
        setError(
          cause instanceof Error
            ? `Mise en attente impossible : ${cause.message}`
            : "L'envoi a echoue. Reessayez.",
        )
      } finally {
        setPhase(null)
        setFilename(null)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [queue],
  )

  const handleFile = useCallback(
    async (file: File) => {
      setError(null)
      const invalid = describeFileError(file)
      if (invalid) {
        setError(invalid)
        return
      }

      setFilename(file.name)
      setPercent(0)

      // Sans reseau, inutile de tenter : le fichier part en attente et le
      // magasin le renverra des le retour de la connexion.
      if (!navigator.onLine) {
        await defer(file)
        return
      }

      try {
        await uploadTrack(file, {
          onProgress: (progress) => {
            setPhase(progress.phase)
            setPercent(progress.percent)
          },
        })
        onUploaded()
      } catch (cause) {
        if (isTransient(cause)) {
          await defer(file)
          return
        }
        setError(cause instanceof UploadError ? cause.message : "L'envoi a echoue. Reessayez.")
      } finally {
        setPhase(null)
        setFilename(null)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [defer, onUploaded],
  )

  return (
    <section className="flex flex-col gap-3" aria-label="Ajouter un morceau">
      <div
        onDragOver={(event) => {
          event.preventDefault()
          if (!busy) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files[0]
          if (file && !busy) void handleFile(file)
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors sm:p-10',
          dragging ? 'border-brand bg-muted' : 'border-input bg-card',
          busy && 'opacity-70',
        )}
      >
        {busy ? (
          <Loader2 aria-hidden className="size-6 animate-spin text-brand" />
        ) : (
          <Upload aria-hidden className="size-6 text-muted-foreground" />
        )}

        <div className="flex flex-col gap-1">
          <p className="font-medium">{busy ? PHASE_LABELS[phase] : 'Deposez un fichier audio'}</p>
          <p className="text-sm text-muted-foreground">
            {busy && filename ? filename : 'MP3, WAV, FLAC, M4A ou OGG — 100 Mo maximum'}
          </p>
        </div>

        {busy ? (
          <div className="w-full max-w-sm">
            <Progress
              // Hors phase d'envoi la duree est inconnue : la barre reste pleine et
              // pulse, plutot que d'afficher une progression inventee.
              value={phase === 'uploading' ? percent : 100}
              aria-label={`${PHASE_LABELS[phase]}${phase === 'uploading' ? ` : ${percent} %` : ''}`}
              className={cn('h-2', phase !== 'uploading' && 'animate-pulse')}
            />
            {phase === 'uploading' ? (
              <p className="mt-1.5 text-xs tabular-nums text-muted-foreground">{percent} %</p>
            ) : null}
          </div>
        ) : (
          <Button type="button" onClick={() => inputRef.current?.click()}>
            Choisir un fichier
          </Button>
        )}

        <input
          ref={inputRef}
          type="file"
          // Le champ est masque et declenche par le bouton voisin : sans nom
          // propre, un lecteur d'ecran qui l'atteint ne sait pas ce qu'il est.
          aria-label="Fichier audio a envoyer"
          accept={ACCEPTED_TYPES}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {queue.rejected ? (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>Un envoi en attente a ete refuse : {queue.rejected}</span>
            <Button type="button" size="sm" variant="ghost" onClick={queue.dismissRejection}>
              Fermer
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {queue.items.length > 0 ? (
        <section
          aria-label="Envois en attente"
          data-testid="upload-queue"
          className="flex flex-col gap-2 rounded-xl border border-input bg-card p-4"
        >
          <div className="flex items-center gap-2">
            <CloudUpload aria-hidden className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium">
              {queue.items.length === 1
                ? '1 envoi en attente de connexion'
                : `${queue.items.length} envois en attente de connexion`}
            </p>
          </div>

          <ul className="flex flex-col gap-1">
            {queue.items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate">{item.filename}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatBytes(item.bytes)}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Annuler l'envoi de ${item.filename}`}
                  onClick={() => void queue.remove(item.id)}
                >
                  <X aria-hidden className="size-4" />
                </Button>
              </li>
            ))}
          </ul>

          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="self-start"
            disabled={queue.flushing}
            onClick={() => void queue.retry()}
          >
            {queue.flushing ? 'Envoi en cours...' : 'Reessayer maintenant'}
          </Button>
        </section>
      ) : null}
    </section>
  )
}

/**
 * Un echec transitoire merite une mise en attente ; un refus, non.
 *
 * `fetch` leve un `TypeError` nu quand le reseau tombe en cours de requete :
 * c'est le cas le plus courant, et il n'a pas de code.
 */
function isTransient(cause: unknown): boolean {
  if (cause instanceof UploadError) {
    return cause.code === 'upstream_unavailable' || cause.code === 'internal_error'
  }
  return cause instanceof TypeError
}

export { formatBytes }
