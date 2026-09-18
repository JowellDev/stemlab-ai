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

---

## Phase 1 — Moteur audio multipiste (2026-09-17)

**Definition of Done — vérifiée par exécution**

| Critère                           | Vérification                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------- |
| 4 stems de test dans le dépôt     | ✅ `apps/web/public/dev-stems/`, synthétisés par `scripts/make-test-stems.py` |
| Lecture parfaitement synchrone    | ✅ 77 tests unitaires + 26 tests navigateur                                   |
| Dérive nulle après un seek        | ✅ `start()` instrumenté : `when` et `offset` uniques après chaque seek       |
| Tests unitaires du planificateur  | ✅ `scheduler.test.ts` et `transport-clock.test.ts`                           |
| Une piste par stem + forme d'onde | ✅ peaks pré-calculés, aucun décodage complet côté client                     |
| Barre de transport                | ✅ lecture/pause, retour au début, seek au pointeur                           |
| Raccourcis clavier                | ✅ espace, flèches, M, S, Maj, Échap, Origine                                 |
| Mobile 390 px                     | ✅ `scrollWidth == clientWidth`, suite E2E verte sur ce format                |

**Non vérifié**

- L'écoute directe : l'environnement d'exécution n'a pas de sortie audio. Elle est
  remplacée par l'instrumentation de `AudioBufferSourceNode.start()` dans Chromium,
  qui constate l'égalité **exacte** des instants de démarrage — un critère plus strict
  qu'une absence de décalage perceptible.

---

## Phase 2 — Pipeline ML en local (2026-09-17)

**Definition of Done — vérifiée par exécution**

| Critère                                  | Vérification                                             |
| ---------------------------------------- | -------------------------------------------------------- |
| `uv run python -m ml.pipeline <fichier>` | ✅ produit stems + `analysis.json`                       |
| Sortie valide sur trois styles           | ✅ rock (WAV), électro (MP3), ballade (FLAC)             |
| `analysis.json` conforme au contrat      | ✅ validé par le schéma Zod depuis TypeScript            |
| Normalisation ffmpeg 44,1 kHz            | ✅ testée depuis WAV, MP3, mono et stéréo                |
| Stems encodés en Opus 96 kb/s            | ✅ WAV conservable via `--keep-wav`                      |
| Accords sur `bass + other` remixés       | ✅ lissés temporellement, alignés sur la grille de temps |
| Peaks 512 points/seconde dans le JSON    | ✅ pour le mix et pour chaque stem                       |
| Durée mesurée et consignée — CPU         | ✅ 0,37 à 0,60 × temps réel (16 cœurs)                   |
| Modèle 6 stems                           | ✅ `htdemucs_6s` vérifié : guitare et piano séparés      |

**Non vérifié**

- **Temps de traitement GPU** : ce poste n'a pas de GPU. La mesure est reportée à la
  phase 9, où le worker Modal (L4) la fournira dans les conditions de production.
- **Qualité de séparation sur de la musique réelle** : les morceaux de test sont
  synthétisés, et Demucs est entraîné sur de l'audio réel. Ces fichiers valident
  l'enchaînement du pipeline, pas la qualité de la séparation.

---

## Phase 3 — Service de jobs (2026-09-17)

**Definition of Done — vérifiée par exécution réelle**

Stack complète lancée localement : Redis, S3, API, worker ARQ et un receveur de
webhook vérifiant la signature.

| Critère                               | Vérification                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| Job de bout en bout depuis un `curl`  | ✅ `202 Accepted` → 4 stems dans S3, webhook de succès signé reçu                |
| Progression incrémentale              | ✅ `GET /jobs/{id}` et webhooks `job.progress` (pas de 10 points)                |
| Webhook signé HMAC                    | ✅ signature vérifiée par le receveur à chaque livraison                         |
| Idempotence par checksum              | ✅ second dépôt → `deduplicated: true`, webhook rejoué, aucun retraitement       |
| Échec simulé correctement remonté     | ✅ objet absent → `job.failed` non rejouable + file de rebut                     |
| Reessais avec recul exponentiel       | ✅ 5 s puis 20 s, trois essais au total                                          |
| Timeout                               | ✅ 600 s, aligné sur le plafond du worker GPU Modal                              |
| File de rebut                         | ✅ `GET /dead-letters`, bornée à 1000 entrées                                    |
| Redémarrage du worker en cours de job | ✅ interrompu à 10 %, repris à l'essai 2 sur un worker neuf, terminé normalement |

**Mesures de l'exécution réelle**

| Étape                 | Résultat                                                             |
| --------------------- | -------------------------------------------------------------------- |
| Morceau de 15 s       | 14,9 s de traitement, 4 stems                                        |
| Morceau de 128 s      | 53,1 s de traitement, 80 segments d'accords, `A minor`, `120,01 BPM` |
| Reprise après coupure | job terminé à l'essai 2, aucun stem manquant                         |

**Tests** : 205 côté Python, 58 côté contrats. `ruff` et `mypy --strict` propres.

---

## Phase 4 — Auth, upload, bibliothèque (2026-09-18)

**Definition of Done — vérifiée par exécution contre la stack réelle**

| Critère                             | Vérification                                              |
| ----------------------------------- | --------------------------------------------------------- |
| better-auth opérationnel            | ✅ inscription, connexion, déconnexion, sessions en base  |
| Upload direct par URL présignée     | ✅ l'audio ne transite jamais par l'application           |
| Barre de progression                | ✅ XHR (`fetch` n'expose pas la progression d'envoi)      |
| Validation type et taille           | ✅ 100 Mo, mp3/wav/flac/m4a/ogg ; refus testé             |
| Bibliothèque avec statuts en direct | ✅ SSE, passage à « Prêt » sans rechargement              |
| Suppression d'un morceau            | ✅ ligne et objets S3                                     |
| Parcours complet Playwright         | ✅ inscription → upload → `ready` → lecture → suppression |

**Mesures de l'exécution réelle**

| Étape                           | Résultat                                 |
| ------------------------------- | ---------------------------------------- |
| Traitement d'un extrait de 15 s | 8,7 s, 4 stems                           |
| Suite E2E complète              | 30 tests verts, desktop et mobile 390 px |

**Non vérifié**

- **OAuth Google** : le code est en place et ne s'active que si les identifiants sont
  renseignés, mais aucun compte Google n'est disponible pour l'éprouver.
- **Vérification de l'adresse électronique** : désactivée, faute de service d'envoi.
  À activer en phase 8 avec le fournisseur retenu.
- **Quotas par utilisateur** : le champ `plan` existe en base, l'application arrive en
  phase 8.

**Restructurations effectuées pendant la phase**

- Prisma déplacé dans `packages/database`
- Composants UI extraits dans `packages/ui`, sur shadcn/ui
- Routes groupées (`auth/`, `dashboard/`, `api/`) et nommées en anglais

---

## Phase 5 — Accords, tonalité, tempo (2026-09-18)

**Definition of Done — vérifiée par exécution**

La propriété testée est auto-référente : l'accord mis en avant doit contenir la
position de lecture dans ses propres bornes. Elle vaut quelle que soit la cause d'un
désalignement.

| Critère                                       | Vérification                                |
| --------------------------------------------- | ------------------------------------------- |
| Accords synchronisés à la lecture             | ✅                                          |
| Alignement conservé après seek                | ✅ quatre positions successives             |
| Alignement conservé après changement de tempo | ✅ à 75 % puis 125 %                        |
| Alignement conservé après transposition       | ✅ bornes inchangées                        |
| Grille de mesures                             | ✅ phase calée sur les changements d'accord |
| Tonalité et BPM en en-tête                    | ✅ valeurs entendues, pas analysées         |
| Transposition des libellés                    | ✅ orthographe selon l'armure obtenue       |
| Défilement automatique                        | ✅                                          |
| Vue grille et vue ligne de temps              | ✅                                          |

**Tests** : 58 unitaires (`@stemlab/music`), 86 (`@stemlab/audio-engine`),
48 E2E sur deux formats dont 390 px.

**Non vérifié / reporté**

- **Le changement de tempo déplace encore la hauteur** : l'implémentation agit sur le
  `playbackRate` des sources. La phase 6 la remplace par un AudioWorklet SoundTouch,
  qui dissocie tempo et hauteur — l'API exposée ne change pas.
- **La transposition ne modifie pas encore l'audio**, seulement les libellés. Même
  échéance.
