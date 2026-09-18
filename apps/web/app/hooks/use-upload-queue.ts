import { useEffect, useSyncExternalStore } from 'react'
import {
  dismissRejection,
  enqueue,
  flush,
  getServerSnapshot,
  getSnapshot,
  remove,
  setOnSent,
  subscribe,
  type UploadQueueState,
} from '~/lib/upload-queue-store'

export interface UseUploadQueue extends UploadQueueState {
  enqueue: (file: File) => Promise<void>
  remove: (id: string) => Promise<void>
  retry: () => Promise<void>
  dismissRejection: () => void
}

/**
 * File d'envoi differee.
 *
 * `onSent` permet a la bibliotheque de se rafraichir quand un envoi mis en
 * attente finit par passer, sans qu'elle ait a scruter la file.
 */
export function useUploadQueue(onSent?: () => void): UseUploadQueue {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    setOnSent(onSent ?? null)
    return () => setOnSent(null)
  }, [onSent])

  return { ...state, enqueue, remove, retry: flush, dismissRejection }
}
