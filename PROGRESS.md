# Avancement

| Phase | Intitulé                   | Statut      | Date       | Reste à faire                                                                |
| ----- | -------------------------- | ----------- | ---------- | ---------------------------------------------------------------------------- |
| 0     | Bootstrap                  | ✅ terminée | 2026-09-17 | `docker compose up` non vérifié (Docker absent du poste — voir DECISIONS.md) |
| 1     | Moteur audio multipiste    | ⏳ à venir  | —          | —                                                                            |
| 2     | Pipeline ML en local       | ⏳ à venir  | —          | —                                                                            |
| 3     | Service de jobs            | ⏳ à venir  | —          | —                                                                            |
| 4     | Auth, upload, bibliothèque | ⏳ à venir  | —          | —                                                                            |
| 5     | Accords, tonalité, tempo   | ⏳ à venir  | —          | —                                                                            |
| 6     | Pitch et tempo             | ⏳ à venir  | —          | —                                                                            |
| 7     | PWA et hors-ligne          | ⏳ à venir  | —          | —                                                                            |
| 8     | Durcissement               | ⏳ à venir  | —          | —                                                                            |
| 9     | Production                 | ⏳ à venir  | —          | —                                                                            |

---

## Phase 0 — Bootstrap (2026-09-17)

**Definition of Done — vérifiée par exécution**

| Critère                      | Vérification                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm dev` lance web + ml    | ✅ les deux processus démarrent via `turbo run dev --parallel`                                |
| `/health` répond 200 sur web | ✅ `{"status":"ok","service":"web","version":"dev"}`                                          |
| `/health` répond 200 sur ml  | ✅ `{"status":"ok","service":"ml","model":"htdemucs","device":"cpu"}`                         |
| La page d'accueil rend       | ✅ HTTP 200, `<h1>` présent dans le HTML servi par le SSR                                     |
| `pnpm typecheck`             | ✅ 4 paquets, aucune erreur (tsc + mypy strict)                                               |
| `pnpm lint`                  | ✅ 4 paquets (eslint + ruff check + ruff format)                                              |
| `pnpm test`                  | ✅ contracts 25 assertions, ml 1 test                                                         |
| `pnpm build`                 | ✅ bundle client + serveur produits                                                           |
| Stack locale complète        | ✅ `pnpm services` : Postgres 17.2, Redis 8.0.3, S3 — aller-retour réel vérifié sur les trois |
| CI                           | ✅ workflow écrit ; les mêmes commandes passent localement                                    |

**Non vérifié**

- `docker compose up` : Docker n'est pas disponible sur ce poste (WSL 2 sans
  intégration Docker Desktop, pas de `sudo`). Le fichier compose est écrit et suit la
  topologie validée par `scripts/dev-services.sh`. À exécuter une fois sur une
  machine équipée avant la phase 9.
- L'exécution réelle de GitHub Actions (nécessite un _push_ vers un dépôt distant).
