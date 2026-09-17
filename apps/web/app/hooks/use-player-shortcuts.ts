import type { MultitrackPlayer } from '@stemlab/audio-engine'
import type { StemType } from '@stemlab/contracts'
import { useEffect } from 'react'

const SEEK_STEP_SECONDS = 5
const FINE_SEEK_STEP_SECONDS = 1

export interface PlayerShortcutsOptions {
  player: MultitrackPlayer | null
  /** Pistes dans l'ordre d'affichage : les fleches haut/bas naviguent dedans. */
  stems: readonly StemType[]
  activeStem: StemType | null
  onActiveStemChange: (type: StemType) => void
  onTogglePlay: () => void
}

/** Les raccourcis ne doivent pas voler la frappe d'un champ de saisie. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Raccourcis clavier du lecteur : espace, fleches, M, S.
 *
 * Ils sont poses sur le document plutot que sur un conteneur focusable : un
 * utilisateur qui vient de cliquer sur une forme d'onde n'a pas de focus explicite,
 * et devoir « rentrer » dans le lecteur avant de pouvoir l'arreter serait hostile.
 */
export function usePlayerShortcuts({
  player,
  stems,
  activeStem,
  onActiveStemChange,
  onTogglePlay,
}: PlayerShortcutsOptions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      const moveActive = (delta: number) => {
        if (stems.length === 0) return
        const current = activeStem ? stems.indexOf(activeStem) : -1
        const next = (current + delta + stems.length) % stems.length
        const type = stems[next]
        if (type) onActiveStemChange(type)
      }

      switch (event.key) {
        case ' ':
        case 'Spacebar':
          event.preventDefault()
          onTogglePlay()
          return

        case 'ArrowRight':
          if (!player) return
          event.preventDefault()
          player.seek(
            player.position + (event.shiftKey ? FINE_SEEK_STEP_SECONDS : SEEK_STEP_SECONDS),
          )
          return

        case 'ArrowLeft':
          if (!player) return
          event.preventDefault()
          player.seek(
            player.position - (event.shiftKey ? FINE_SEEK_STEP_SECONDS : SEEK_STEP_SECONDS),
          )
          return

        case 'ArrowDown':
          event.preventDefault()
          moveActive(1)
          return

        case 'ArrowUp':
          event.preventDefault()
          moveActive(-1)
          return

        case 'Home':
          if (!player) return
          event.preventDefault()
          player.seek(0)
          return

        case 'Escape':
          player?.clearSolos()
          return

        default:
          break
      }

      // `key` suit la disposition du clavier : on compare en minuscules pour que
      // Maj+M reste un mute plutot qu'une touche inconnue.
      const key = event.key.toLowerCase()
      if (!player || !activeStem) return
      if (key === 'm') {
        event.preventDefault()
        player.toggleMute(activeStem)
      } else if (key === 's') {
        event.preventDefault()
        player.toggleSolo(activeStem)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [player, stems, activeStem, onActiveStemChange, onTogglePlay])
}
