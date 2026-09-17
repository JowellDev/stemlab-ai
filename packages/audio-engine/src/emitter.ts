import type { PlayerEvent, PlayerEventListener, PlayerEventType } from './types.js'

type AnyListener = (event: PlayerEvent) => void

/** Emetteur type minimal : pas de dependance, pas d'`EventTarget` a polyfiller. */
export class PlayerEmitter {
  readonly #listeners = new Map<PlayerEventType, Set<AnyListener>>()

  on<T extends PlayerEventType>(type: T, listener: PlayerEventListener<T>): () => void {
    const set = this.#listeners.get(type) ?? new Set<AnyListener>()
    // Le `Map` est indexe par type d'evenement : tout ce qui parvient a ce listener
    // porte deja le bon discriminant. TypeScript ne peut pas l'etablir a travers le
    // parametre generique, d'ou le retrecissement explicite.
    const wrapped: AnyListener = (event) => {
      listener(event as Extract<PlayerEvent, { type: T }>)
    }
    set.add(wrapped)
    this.#listeners.set(type, set)
    return () => {
      set.delete(wrapped)
    }
  }

  emit(event: PlayerEvent): void {
    const set = this.#listeners.get(event.type)
    if (!set) return
    for (const listener of [...set]) {
      listener(event)
    }
  }

  clear(): void {
    this.#listeners.clear()
  }
}
