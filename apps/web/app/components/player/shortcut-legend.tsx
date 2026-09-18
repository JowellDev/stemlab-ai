const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ['Espace', 'Lecture / pause'],
  ['← →', 'Reculer / avancer de 5 s'],
  ['Maj + ← →', 'Pas de 1 s'],
  ['↑ ↓', 'Changer de piste'],
  ['M', 'Couper la piste active'],
  ['S', 'Solo sur la piste active'],
  ['Echap', 'Annuler tous les solos'],
]

export function ShortcutLegend() {
  return (
    <details className="bg-card rounded-lg border p-3 text-sm">
      <summary className="text-muted-foreground cursor-pointer">Raccourcis clavier</summary>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {SHORTCUTS.map(([keys, description]) => (
          <div key={keys} className="flex items-baseline justify-between gap-3">
            <dt>
              <kbd className="bg-muted rounded border px-1.5 py-0.5 font-mono text-xs">{keys}</kbd>
            </dt>
            <dd className="text-muted-foreground">{description}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
