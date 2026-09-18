import {
  MultitrackPlayer,
  type LoadProgress,
  type StemMixState,
  type StemSource,
  type TransportState,
} from '@stemlab/audio-engine'

export interface PlayerState {
  /** `null` avant le montage cote client, et apres liberation. */
  readonly player: MultitrackPlayer | null
  readonly transport: TransportState
  readonly duration: number
  readonly stems: readonly StemMixState[]
  readonly progress: LoadProgress | null
  readonly error: Error | null
  /**
   * Faux quand le moteur d'etirement n'a pas pu etre charge : la lecture reste
   * possible, mais la transposition n'agit que sur les libelles.
   */
  readonly supportsIndependentPitch: boolean
}

/** Etat rendu par le serveur : constant, pour que `useSyncExternalStore` n'y voie
 *  jamais un changement et ne boucle pas. */
export const SERVER_PLAYER_STATE: PlayerState = {
  player: null,
  transport: 'idle',
  duration: 0,
  stems: [],
  progress: null,
  error: null,
  supportsIndependentPitch: true,
}

/**
 * Le lecteur vu comme un store externe.
 *
 * C'est ce qu'il est reellement : un objet imperatif dont l'etat change en dehors de
 * React, au rythme de l'audio. Le passer par `useSyncExternalStore` plutot que par
 * une cascade de `useState` dans un effet evite les rendus en chaine et rend le
 * rendu serveur trivial — il suffit d'un instantane constant.
 */
export class PlayerStore {
  #state: PlayerState = SERVER_PLAYER_STATE
  readonly #listeners = new Set<() => void>()
  #player: MultitrackPlayer | null = null
  #controller: AbortController | null = null
  #unsubscribers: Array<() => void> = []
  #sourcesKey = ''

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  getSnapshot = (): PlayerState => this.#state

  getServerSnapshot = (): PlayerState => SERVER_PLAYER_STATE

  /**
   * Declare les pistes a jouer. Idempotent : appele a chaque rendu, il ne
   * reconstruit le lecteur que si la liste a reellement change. C'est ce qui
   * permet a l'appelant de passer un tableau recree a chaque rendu sans detruire
   * l'AudioContext a chaque fois.
   */
  setSources(sources: readonly StemSource[]): void {
    const key = sources.map((source) => `${source.type}:${source.url}`).join('|')
    if (key === this.#sourcesKey) return
    this.#sourcesKey = key
    this.#teardown()
    if (sources.length === 0) {
      this.#state = SERVER_PLAYER_STATE
      this.#emit()
      return
    }
    this.#start(sources)
  }

  #start(sources: readonly StemSource[]): void {
    let player: MultitrackPlayer
    try {
      player = new MultitrackPlayer()
    } catch (cause) {
      this.#set({ error: toError(cause) })
      return
    }

    const controller = new AbortController()
    this.#player = player
    this.#controller = controller
    this.#unsubscribers = [
      player.on('statechange', (event) =>
        this.#set({
          transport: event.state,
          duration: player.duration,
          stems: player.snapshot().stems,
          supportsIndependentPitch: player.supportsIndependentPitch,
        }),
      ),
      player.on('mixchange', (event) => this.#set({ stems: event.stems })),
      player.on('loadprogress', (event) => this.#set({ progress: event.progress })),
      player.on('fallback', () => this.#set({ supportsIndependentPitch: false })),
    ]

    this.#set({ player, error: null, supportsIndependentPitch: true })

    player.load(sources, { signal: controller.signal }).catch((cause: unknown) => {
      // Une annulation volontaire (demontage, changement de morceau) n'est pas une
      // erreur a afficher. Le controleur est capture ici plutot que relu sur `this` :
      // au demontage, `#controller` est remis a null avant que la promesse ne rejette.
      if (controller.signal.aborted) return
      this.#set({ error: toError(cause) })
    })
  }

  /** Libere toutes les ressources. A appeler au demontage du composant. */
  stop(): void {
    this.#teardown()
    this.#sourcesKey = ''
    this.#state = SERVER_PLAYER_STATE
    this.#emit()
  }

  #teardown(): void {
    this.#controller?.abort()
    for (const off of this.#unsubscribers) off()
    this.#unsubscribers = []
    this.#player?.destroy()
    this.#player = null
    this.#controller = null
  }

  #set(patch: Partial<PlayerState>): void {
    this.#state = { ...this.#state, ...patch }
    this.#emit()
  }

  #emit(): void {
    for (const listener of [...this.#listeners]) listener()
  }
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}
