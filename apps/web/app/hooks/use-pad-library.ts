import type { LibraryPad } from '@stemlab/audio-engine'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type PadEntry,
  addPad,
  assignKey,
  listPads,
  readPad,
  removePad,
} from '~/lib/pad-library.client'

export interface UsePadLibrary {
  entries: readonly PadEntry[]
  /** Identifiants de tonalites pour lesquelles une nappe est prete a sonner. */
  ready: ReadonlySet<string>
  importing: boolean
  error: string | null
  add: (files: FileList | File[]) => Promise<void>
  assign: (id: string, keyId: string) => Promise<void>
  remove: (id: string) => Promise<void>
  dismissError: () => void
}

/**
 * Bibliotheque de nappes personnelle : fichiers, tonalites, et decodage.
 *
 * Le decodage n'a lieu qu'une fois par fichier et par session : un fichier de
 * trente secondes en stereo occupe une quinzaine de megaoctets une fois decode,
 * et le refaire a chaque changement de tonalite ferait tousser la lecture.
 */
export function usePadLibrary(pad: LibraryPad | null): UsePadLibrary {
  const [entries, setEntries] = useState<readonly PadEntry[]>([])
  const [decodedIds, setDecodedIds] = useState<ReadonlySet<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const decoded = useRef(new Set<string>())

  useEffect(() => {
    void listPads()
      .then(setEntries)
      .catch(() => setEntries([]))
  }, [])

  /**
   * Decode ce qui ne l'est pas encore et l'associe a sa tonalite.
   *
   * Une fois par fichier et par session : un fichier de trente secondes en
   * stereo occupe une quinzaine de megaoctets une fois decode, et le refaire a
   * chaque changement de tonalite ferait tousser la lecture.
   */
  useEffect(() => {
    if (!pad) return

    const aDecoder = entries.filter((entry) => entry.keyId && !decoded.current.has(entry.id))
    if (aDecoder.length === 0) return

    let annule = false

    void (async () => {
      for (const entry of aDecoder) {
        const bytes = await readPad(entry.id)
        if (annule) return
        if (!bytes) continue

        try {
          const buffer = await pad.context.decodeAudioData(bytes.slice().buffer as ArrayBuffer)
          if (annule) return
          pad.add(entry.keyId, buffer)
          decoded.current.add(entry.id)
        } catch {
          // Format refuse par le navigateur : cette nappe est ignoree, les
          // autres restent utilisables.
        }
      }

      if (!annule) setDecodedIds(new Set(decoded.current))
    })()

    return () => {
      annule = true
    }
  }, [entries, pad])

  /** Tonalites reellement jouables : un fichier range, decode, et une tonalite assignee. */
  const ready = useMemo(() => {
    const disponibles = new Set<string>()
    for (const entry of entries) {
      if (entry.keyId && decodedIds.has(entry.id)) disponibles.add(entry.keyId)
    }
    return disponibles
  }, [entries, decodedIds])

  const add = useCallback(async (files: FileList | File[]) => {
    setImporting(true)
    setError(null)
    try {
      for (const file of Array.from(files)) await addPad(file)
      setEntries(await listPads())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "L'import a echoue.")
    } finally {
      setImporting(false)
    }
  }, [])

  const assign = useCallback(async (id: string, keyId: string) => {
    await assignKey(id, keyId)
    // La nappe doit etre redecodee sous sa nouvelle tonalite.
    decoded.current.delete(id)
    setDecodedIds(new Set(decoded.current))
    setEntries(await listPads())
  }, [])

  const remove = useCallback(async (id: string) => {
    await removePad(id)
    decoded.current.delete(id)
    setDecodedIds(new Set(decoded.current))
    setEntries(await listPads())
  }, [])

  const dismissError = useCallback(() => setError(null), [])

  return { entries, ready, importing, error, add, assign, remove, dismissError }
}
