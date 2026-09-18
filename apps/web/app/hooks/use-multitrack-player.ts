import type { MultitrackPlayer, StemSource, TransportState } from '@stemlab/audio-engine'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { PlayerStore, type PlayerState } from '~/lib/player-store'

/**
 * Branche le lecteur multipiste sur React.
 *
 * Le lecteur est un store externe : son etat change en dehors de React, au rythme
 * de l'audio. `useSyncExternalStore` est l'outil fait pour ca, et rend le cas
 * serveur trivial — Web Audio n'existe pas cote serveur, l'instantane y est constant.
 */
export function useMultitrackPlayer(
  sources: readonly StemSource[],
  fetchImpl?: typeof fetch,
): PlayerState {
  // Initialiseur paresseux : le constructeur est pur, aucun AudioContext n'est
  // cree avant `setSources`.
  const [store] = useState(() => new PlayerStore())

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)

  useEffect(() => {
    store.setFetch(fetchImpl)
    store.setSources(sources)
  }, [store, sources, fetchImpl])

  useEffect(() => () => store.stop(), [store])

  return state
}

/** Bascule lecture/pause, sans effet tant que rien n'est charge. */
export function usePlayPause(player: MultitrackPlayer | null, transport: TransportState) {
  return useCallback(() => {
    if (!player) return
    if (transport === 'playing') {
      player.pause()
      return
    }
    void player.play().catch(() => {
      // Le contexte n'a pas pu reprendre (geste utilisateur refuse par le
      // navigateur) : l'etat reste inchange et le bouton lecture reste affiche.
    })
  }, [player, transport])
}
