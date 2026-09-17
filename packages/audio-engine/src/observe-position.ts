import type { MultitrackPlayer } from './multitrack-player.js'

/**
 * Notifie la position de lecture a chaque frame d'affichage.
 *
 * `requestAnimationFrame` cadence l'*affichage* ; la valeur, elle, vient toujours de
 * l'horloge audio du lecteur. C'est ce decouplage qui evite qu'un onglet ralenti ou
 * une frame sautee ne desynchronise le curseur du son.
 */
export function observePosition(
  player: MultitrackPlayer,
  onFrame: (position: number) => void,
): () => void {
  const raf = globalThis.requestAnimationFrame
  const cancel = globalThis.cancelAnimationFrame

  if (typeof raf !== 'function') {
    // Environnement sans rAF (SSR, tests) : une seule notification, pas de boucle.
    onFrame(player.position)
    return () => {}
  }

  let handle = 0
  let stopped = false

  const tick = () => {
    if (stopped) return
    onFrame(player.position)
    handle = raf(tick)
  }

  handle = raf(tick)

  return () => {
    stopped = true
    cancel?.(handle)
  }
}
