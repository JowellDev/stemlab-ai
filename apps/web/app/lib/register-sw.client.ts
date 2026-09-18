/**
 * Enregistrement du service worker.
 *
 * On passe par le module virtuel du greffon plutot que par un
 * `navigator.serviceWorker.register('/sw.js')` ecrit a la main : l'URL du worker
 * differe entre developpement et production, et le greffon est le seul a savoir
 * laquelle est la bonne.
 *
 * L'enregistrement attend que la page soit interactive, pour que l'installation
 * du worker et le precache ne disputent pas la bande passante au premier rendu.
 */
export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return

  try {
    const { registerSW } = await import('virtual:pwa-register')
    registerSW({
      immediate: document.readyState === 'complete',
      onRegisterError(error: unknown) {
        // Un enregistrement refuse — contexte non securise, politique
        // restrictive — ne doit pas empecher l'application de fonctionner.
        console.warn('service worker non enregistre', error)
      },
    })
  } catch (error) {
    console.warn('service worker indisponible', error)
  }
}
