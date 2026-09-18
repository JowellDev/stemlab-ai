/**
 * Validation d'une cible de redirection.
 *
 * Un `redirectTo` vient de l'URL, donc de l'exterieur. Le renvoyer tel quel dans un
 * en-tete `Location` ouvrirait une redirection arbitraire : un lien vers notre
 * domaine renverrait l'utilisateur ailleurs, apres qu'il s'est authentifie chez nous.
 * Seuls les chemins internes sont acceptes.
 */
export function safeRedirect(target: unknown, fallback = '/library'): string {
  if (typeof target !== 'string' || target.length === 0) return fallback
  // `//evil.com` et `/\evil.com` sont interpretes comme des URL absolues par les
  // navigateurs : un seul slash initial ne suffit pas comme controle.
  if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
    return fallback
  }
  return target
}
