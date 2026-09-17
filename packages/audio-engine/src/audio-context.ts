/**
 * Creation et deverrouillage de l'AudioContext.
 *
 * Safari (iOS en particulier) cree tout AudioContext a l'etat `suspended` et ne le
 * laisse reprendre que depuis la pile d'appel d'un geste utilisateur. Un simple
 * `resume()` ne suffit pas toujours : il faut aussi avoir joue au moins un buffer.
 * On declenche donc, dans le meme gestionnaire, la lecture d'un buffer silencieux
 * d'une frame.
 */

export interface AudioContextOptions {
  /** 44 100 Hz par defaut : c'est le taux de sortie du pipeline. */
  readonly sampleRate?: number
  readonly latencyHint?: AudioContextLatencyCategory | number
}

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext

function resolveConstructor(): AudioContextConstructor {
  const candidate =
    globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
  if (!candidate) {
    throw new Error("Web Audio n'est pas disponible dans cet environnement")
  }
  return candidate as AudioContextConstructor
}

export function createAudioContext(options: AudioContextOptions = {}): AudioContext {
  const Ctor = resolveConstructor()
  return new Ctor({ sampleRate: options.sampleRate ?? 44_100, ...options })
}

const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'keydown'] as const

/**
 * Deverrouille le contexte au premier geste utilisateur et se desabonne ensuite.
 * Renvoie une fonction d'annulation, a appeler quand le lecteur est detruit.
 */
export function unlockOnFirstGesture(context: AudioContext): () => void {
  if (context.state === 'running') return () => {}

  const target = globalThis.document as Document | undefined
  if (!target) return () => {}

  const unlock = () => {
    void context.resume().catch(() => {
      // Le geste n'etait pas eligible : on garde les ecouteurs pour le suivant.
    })
    primeWithSilentBuffer(context)
    if (context.state === 'running') dispose()
  }

  const dispose = () => {
    for (const event of UNLOCK_EVENTS) {
      target.removeEventListener(event, unlock)
    }
  }

  for (const event of UNLOCK_EVENTS) {
    target.addEventListener(event, unlock, { passive: true })
  }

  return dispose
}

/** Une frame de silence : suffit a faire basculer Safari en `running`. */
function primeWithSilentBuffer(context: AudioContext): void {
  try {
    const buffer = context.createBuffer(1, 1, context.sampleRate)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.start(0)
  } catch (error) {
    // Un contexte ferme entre-temps leve ici ; il n'y a plus rien a deverrouiller.
    if (!(error instanceof Error)) throw error
  }
}
