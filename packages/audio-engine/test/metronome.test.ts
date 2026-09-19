import { beforeEach, describe, expect, it } from 'vitest'
import { LOOKAHEAD_SECONDS, Metronome, type MetronomeBeat } from '../src/metronome.js'
import { FakeAudioContext, asAudioContext } from './fake-audio-context.js'

/** Quatre temps par mesure a 120 BPM : un temps toutes les demi-secondes. */
function mesures(nombre: number): MetronomeBeat[] {
  const beats: MetronomeBeat[] = []
  for (let i = 0; i < nombre * 4; i++) {
    beats.push({ time: i * 0.5, position: (i % 4) + 1 })
  }
  return beats
}

describe('Metronome', () => {
  let context: FakeAudioContext
  let metronome: Metronome

  beforeEach(() => {
    context = new FakeAudioContext()
    metronome = new Metronome(asAudioContext(context))
    metronome.setBeats(mesures(8))
  })

  /** Instants auxquels un clic a ete programme. */
  const clics = () => context.createdOscillators.map((o) => o.startedAt)

  it('trie les temps a la mise en place', () => {
    const desordre = [
      { time: 1, position: 3 },
      { time: 0, position: 1 },
      { time: 0.5, position: 2 },
    ]
    metronome.setBeats(desordre)

    expect(metronome.beats.map((b) => b.time)).toEqual([0, 0.5, 1])
  })

  it('programme les temps de la fenetre a venir', () => {
    metronome.schedule(0, 1, 10)

    // A 120 BPM, la fenetre de 0,35 s couvre les temps a 0 et 0,5 ? Non : seul
    // celui a 0 y entre. La fenetre est volontairement courte.
    expect(context.createdOscillators).toHaveLength(1)
    expect(clics()[0]).toBeCloseTo(10, 5)
  })

  it('ne reprogramme pas un temps deja programme', () => {
    metronome.schedule(0, 1, 10)
    const avant = context.createdOscillators.length

    metronome.schedule(0.1, 1, 10.1)

    // Le temps a 0 est derriere, celui a 0,5 n'est pas encore dans la fenetre.
    expect(context.createdOscillators).toHaveLength(avant)
  })

  it('avance avec la tete de lecture', () => {
    metronome.schedule(0, 1, 10)
    metronome.schedule(0.3, 1, 10.3)

    // A 0,3 s, la fenetre atteint 0,65 s : le temps a 0,5 entre.
    expect(context.createdOscillators).toHaveLength(2)
    expect(clics()[1]).toBeCloseTo(10.3 + 0.2, 5)
  })

  it('convertit l ecart selon la vitesse de lecture', () => {
    // A 50 %, une seconde de morceau dure deux secondes reelles : le temps a
    // 0,5 s du morceau doit sonner 0,3 s plus tard dans le monde reel.
    metronome.schedule(0.35, 0.5, 10)

    const attendus = clics()
    expect(attendus).toHaveLength(1)
    expect(attendus[0]).toBeCloseTo(10 + (0.5 - 0.35) / 0.5, 5)
  })

  it('couvre moins de morceau quand la lecture ralentit', () => {
    // La fenetre d'avance est exprimee en temps reel : a vitesse reduite, elle
    // atteint une portion plus courte du morceau.
    metronome.schedule(0.3, 0.5, 10)
    expect(context.createdOscillators).toHaveLength(0)
  })

  it('accentue le premier temps de la mesure', () => {
    metronome.schedule(0, 1, 10)
    const accent = context.createdOscillators[0]!

    metronome.schedule(0.3, 1, 10.3)
    const faible = context.createdOscillators[1]!

    expect(accent.frequency.value).toBeGreaterThan(faible.frequency.value)
  })

  it('ne rattrape pas un temps deja passe', () => {
    // On demarre au milieu : le temps a 0 ne doit pas sonner en retard.
    metronome.schedule(1.2, 1, 10)

    const attendus = clics()
    expect(attendus.every((when) => when! >= 10)).toBe(true)
  })

  it('repart proprement apres un deplacement en arriere', () => {
    metronome.schedule(2, 1, 10)
    const avant = context.createdOscillators.length

    metronome.schedule(0, 1, 20)

    // Les clics programmes pour l'ancienne position sont annules.
    expect(context.createdOscillators.length).toBeGreaterThan(avant)
    expect(context.createdOscillators.slice(0, avant).every((o) => o.stopped)).toBe(true)
  })

  it('repart proprement apres un saut en avant', () => {
    metronome.schedule(0, 1, 10)
    metronome.schedule(3, 1, 13)

    const dernier = clics().at(-1)!
    // Le clic suit la nouvelle position, pas l'ancienne.
    expect(dernier).toBeGreaterThanOrEqual(13)
  })

  it('ne programme rien sans temps', () => {
    metronome.setBeats([])
    metronome.schedule(0, 1, 10)

    expect(context.createdOscillators).toHaveLength(0)
  })

  it('ignore une vitesse nulle ou negative', () => {
    metronome.schedule(0, 0, 10)
    expect(context.createdOscillators).toHaveLength(0)
  })

  it('couvre une fenetre plus large quand la lecture accelere', () => {
    const lent = new FakeAudioContext()
    const a = new Metronome(asAudioContext(lent))
    a.setBeats(mesures(8))
    a.schedule(0, 1, 0)

    const rapide = new FakeAudioContext()
    const b = new Metronome(asAudioContext(rapide))
    b.setBeats(mesures(8))
    b.schedule(0, 2, 0)

    // A vitesse double, la meme avance reelle couvre deux fois plus de morceau.
    expect(rapide.createdOscillators.length).toBeGreaterThan(lent.createdOscillators.length)
  })

  it('retarde les clics de la latence du moteur', () => {
    const context2 = new FakeAudioContext()
    const avecLatence = new Metronome(asAudioContext(context2), { latency: 0.12 })
    avecLatence.setBeats(mesures(8))

    avecLatence.schedule(0, 1, 10)

    // Le moteur d'etirement rend sa sortie apres coup : sans ce retard, le clic
    // tombe avant le son et s'entend comme un contretemps.
    expect(context2.createdOscillators[0]!.startedAt).toBeCloseTo(10.12, 5)
  })

  it('n applique le retard qu une fois, malgre la vitesse', () => {
    const context2 = new FakeAudioContext()
    const avecLatence = new Metronome(asAudioContext(context2), { latency: 0.1 })
    avecLatence.setBeats(mesures(8))

    // Le retard du moteur est en temps reel : il ne se divise pas par la vitesse,
    // contrairement a l'ecart jusqu'au prochain temps.
    avecLatence.schedule(0.35, 0.5, 10)

    expect(context2.createdOscillators[0]!.startedAt).toBeCloseTo(10 + 0.15 / 0.5 + 0.1, 5)
  })

  it('accepte un retard mesure apres coup', () => {
    metronome.setLatency(0.2)
    metronome.schedule(0, 1, 10)

    expect(context.createdOscillators[0]!.startedAt).toBeCloseTo(10.2, 5)
  })

  it('refuse un retard negatif', () => {
    metronome.setLatency(-1)
    metronome.schedule(0, 1, 10)

    expect(context.createdOscillators[0]!.startedAt).toBeCloseTo(10, 5)
  })

  it('borne le volume', () => {
    metronome.setVolume(5)
    expect(context.createdGains[0]!.gain.target).toBe(1)
    metronome.setVolume(-1)
    expect(context.createdGains[0]!.gain.target).toBe(0)
  })

  it('arrete tout a la destruction', () => {
    metronome.schedule(0, 1, 10)
    metronome.dispose()

    expect(context.createdOscillators.every((o) => o.stopped)).toBe(true)
  })

  it('ne programme plus rien apres destruction', () => {
    metronome.dispose()
    metronome.schedule(0, 1, 10)

    expect(context.createdOscillators).toHaveLength(0)
  })

  it('garde une avance de programmation courte', () => {
    // Une avance longue laisserait sonner des clics faux apres un deplacement.
    expect(LOOKAHEAD_SECONDS).toBeLessThanOrEqual(0.5)
  })
})
