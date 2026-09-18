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
| 7     | PWA et hors-ligne          | ✅ terminée | 2026-09-18 | Installation Chrome Android / Safari iOS non constatée (aucun appareil ici)  |
| 8     | Durcissement               | ✅ terminée | 2026-09-18 | `pg_dump` non exécutable ici ; DSN Sentry manquant (voir DECISIONS.md)       |
| 9     | Paroles et traduction      | ✅ terminée | 2026-09-18 | Qualité sur du chant non constatée (aucun extrait chanté libre ici)          |
| 10    | Production                 | ⏳ à venir  | —          | Anciennement phase 9                                                         |

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

---

## Phase 6 — Pitch et tempo (2026-09-18)

**Definition of Done — vérifiée par exécution**

| Critère                                                               | Vérification                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Étirement WASM dans un AudioWorklet                                   | ✅ Signalsmith Stretch — **écart à la spécification documenté**         |
| Hauteur ±12 demi-tons                                                 | ✅ mesuré aux bornes                                                    |
| Tempo 50–150 %                                                        | ✅ mesuré aux bornes                                                    |
| Tempo et hauteur indépendants                                         | ✅ le repli l'annonce quand il ne l'est pas                             |
| Appliqué identiquement à toutes les pistes                            | ✅ un seul nœud porte tous les canaux                                   |
| **Aucune dérive entre pistes après 5 minutes à 75 % et −3 demi-tons** | ✅ **0 échantillon d'écart**, 99 événements mesurés sur 404 s de sortie |
| Licence documentée                                                    | ✅ MIT au lieu de LGPL — la contrainte disparaît                        |

**Écart à la spécification, assumé et justifié**

La spécification demandait SoundTouch en WASM. Aucun portage WASM n'est publié, et le
« lien dynamique » qu'exigerait sa LGPL n'a pas de sens pour un module empaqueté dans
un _bundle_ navigateur. Signalsmith Stretch est en WASM **et** sous licence MIT : il
satisfait les deux intentions mieux que ce que la spécification nommait. Rubber Band
reste écarté, comme demandé.

**Tests** : 115 unitaires (`@stemlab/audio-engine`), 56 E2E sur deux formats.

**Non vérifié**

- **L'absence d'accroc audio sur un processeur de milieu de gamme** : l'environnement
  n'a pas de sortie audio. Le rendu hors-ligne prouve la justesse du traitement, pas
  la tenue en temps réel sous charge. À constater à l'oreille avant la mise en
  production.

---

## Phase 7 — PWA et hors-ligne (2026-09-18)

**Definition of Done — vérifiée par exécution**

| Critère                                                  | Vérification                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| Manifeste et application installable                     | ✅ vérifié sur le build de production                                 |
| Icônes 192/512 + maskable                                | ✅ servies, dimensions contrôlées                                     |
| Service worker enregistré et actif                       | ✅                                                                    |
| **Un morceau téléchargé se lit en mode avion**           | ✅ lecture **et** seek, réseau réellement coupé au niveau du contexte |
| Un morceau non téléchargé ne prétend pas être disponible | ✅ page de repli statique, aucun bouton de lecture                    |
| File d'envoi différée                                    | ✅ mise en attente sans réseau, reprise automatique au retour         |
| Mobile 390 px                                            | ✅ un format d'exécution complet parmi les trois                      |

**Tests** : 61 unitaires (`@stemlab/offline`), 58 E2E sur trois formats.

**Lighthouse** (build de production, `/login`, mobile 390 px) : performance 97,
accessibilité 100, bonnes pratiques 100, SEO 100.

**Non vérifié**

- **Le « score PWA ≥ 90 » de la spécification** : cette catégorie a été retirée de
  Lighthouse à partir de la version 12. Ses critères sont vérifiés un à un par
  `e2e/offline.spec.ts` — voir `DECISIONS.md`.
- **L'installation réelle sur Chrome Android et Safari iOS** : aucun appareil ni
  émulateur disponible ici. À constater avant la mise en production.

**Feuille de route modifiée.** Les paroles et leur traduction passent en phase 9, à la
demande, avant la mise en production qui devient la phase 10.

---

## Phase 8 — Durcissement (2026-09-18)

**Definition of Done — vérifiée par exécution**

| Critère                                   | Vérification                                                   |
| ----------------------------------------- | -------------------------------------------------------------- |
| Limitation de débit                       | ✅ Redis + repli local, `Retry-After` — refus vérifié par test |
| Quotas par plan                           | ✅ 5 morceaux/mois, 4 pistes en gratuit ; affichés en continu  |
| Erreurs typées de bout en bout            | ✅ code, statut et champs traversent HTTP                      |
| Journaux structurés                       | ✅ JSON + `x-request-id` sur chaque réponse                    |
| `/metrics`                                | ✅ format Prometheus, protégé par jeton                        |
| Rétention S3                              | ✅ 34 orphelins réels supprimés, 1680 objets légitimes intacts |
| Accessibilité AA et clavier               | ✅ axe sur 4 pages, 3 défauts réels corrigés                   |
| CSP                                       | ✅ nominative par nonce, vérifiée sur le build de production   |
| Validation Zod aux frontières             | ✅ corps **et** identifiants d'URL                             |
| Signature du webhook strictement vérifiée | ✅ sur le corps brut, avant désérialisation                    |
| Aucun secret dans le bundle client        | ✅ vérificateur en CI, validé par contrôle négatif             |

**Tests** : 80 E2E sur trois formats, dont onze de durcissement et d'accessibilité.

**Non vérifié**

- **Le dump PostgreSQL** : `pg_dump` n'est pas installable sur ce poste — quatre
  approches distinctes ont échoué. Le dépôt et la rétention, eux, ont été exécutés
  pour de bon contre le stockage objet. La commande de dump est dans
  `scripts/backup-database.sh` ; à exécuter une fois sur une machine équipée.
- **La remontée vers Sentry** : le DSN est un secret que je n'ai pas. Le câblage
  est en place et reste sans effet tant que `SENTRY_DSN` est vide.
- **Un échec intermittent du test hors-ligne** sous charge machine : le navigateur
  refuse l'écriture pour place insuffisante alors qu'il annonce 2 Gio de quota. Le
  test porte désormais les chiffres du stockage dans son message d'échec.

---

## Phase 9 — Paroles et traduction (2026-09-18)

**Definition of Done — vérifiée par exécution**

| Critère                                    | Vérification                                         |
| ------------------------------------------ | ---------------------------------------------------- |
| Transcription sur la voix isolée           | ✅ après séparation, WAV temporaire en 16 kHz        |
| Horodatage au mot                          | ✅ ordre croissant vérifié                           |
| Détection de langue                        | ✅ `en` à 0,945 sur l'extrait de référence           |
| Traduction français ↔ anglais              | ✅ les deux sens, une traduction par ligne           |
| Défilement synchronisé, clic pour naviguer | ✅ même mécanisme que la grille d'accords            |
| Licences commerciales                      | ✅ Whisper MIT, OPUS-MT permissif — NLLB-200 écarté  |
| Un instrumental ne produit rien            | ✅ vérifié sur une sinusoïde                         |
| Disponible hors-ligne                      | ✅ voyage dans la page en cache, traduction comprise |
| Accessibilité AA du panneau                | ✅ axe sur une page de morceau avec paroles          |

**Tests** : 85 E2E sur trois formats, 222 Python, 115 du moteur audio.

**Mesure** : extrait de 11 s, processeur, modèle `small` — pipeline complet en
22,8 s, transcription et traduction comprises. Traduction à chaud : 0,15 s.

**Non vérifié**

- **La qualité sur du chant** : l'extrait de référence est de la parole. Le chant
  se transcrit moins bien, et aucun extrait chanté libre de droits n'était
  disponible ici. À constater sur un vrai morceau.
- **Le modèle `large-v3`** : seul `small` a été exécuté ici. Le passage se fait par
  `WHISPER_MODEL`, mais ni le temps ni la qualité n'ont été mesurés.
