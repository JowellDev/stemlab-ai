import { Alert, AlertDescription, Button, Progress, cn } from '@stemlab/ui'
import { Loader2, Upload } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
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
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<UploadPhase | null>(null)
  const [percent, setPercent] = useState(0)
  const [filename, setFilename] = useState<string | null>(null)

  const busy = phase !== null && phase !== 'done'

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

      try {
        await uploadTrack(file, {
          onProgress: (progress) => {
            setPhase(progress.phase)
            setPercent(progress.percent)
          },
        })
        onUploaded()
      } catch (cause) {
        setError(cause instanceof UploadError ? cause.message : "L'envoi a echoue. Reessayez.")
      } finally {
        setPhase(null)
        setFilename(null)
        if (inputRef.current) inputRef.current.value = ''
      }
    },
    [onUploaded],
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
    </section>
  )
}

export { formatBytes }
