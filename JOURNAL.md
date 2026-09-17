# Journal de construction

Journal chronologique et détaillé de la construction de STEMLAB : chaque étape, ce
qui a été fait, ce qui a résisté et comment ça a été résolu.

- Vue synthétique par phase → [PROGRESS.md](PROGRESS.md)
- Décisions d'architecture et leurs justifications → [DECISIONS.md](DECISIONS.md)

---

# Phase 0 — Bootstrap

**2026-09-17** · branche `phase/00-bootstrap` · commit `602fcb3`

## 0.1 — Reconnaissance de l'environnement

Le répertoire de travail était vide : démarrage réellement à zéro.

Inventaire de l'outillage disponible :

| Outil      | État                            |
| ---------- | ------------------------------- |
| Node       | v24.18.0 ✅                     |
| pnpm       | 11.22.0 ✅                      |
| Python     | 3.12.3 ✅                       |
| ffmpeg     | 6.1.1 ✅                        |
| git        | 2.43.0 ✅                       |
| gcc / make | ✅                              |
| **Docker** | ❌ absent de cette distro WSL 2 |
| **sudo**   | ❌ mot de passe requis          |
| **uv**     | ❌ absent (installé ensuite)    |

Machine : 16 cœurs, 7 Go de RAM, 900 Go libres. Réseau sortant fonctionnel
(npm, PyPI, Maven Central, GitHub).

**Conséquence majeure** : ni Docker ni `sudo` ⇒ impossible de lancer Postgres, Redis
et MinIO par les voies habituelles. Il a fallu construire un chemin alternatif
entièrement en espace utilisateur (voir 0.8).

## 0.2 — Squelette du monorepo

`git init` (branche `main`), puis création de la structure :

```
apps/{web,ml}  packages/{contracts,audio-engine}  infra/{fly,modal}  .github/workflows  scripts
```

Fichiers racine posés : `package.json` (pnpm workspaces + scripts turbo),
`pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json` (TypeScript `strict` +
`noUncheckedIndexedAccess` + `verbatimModuleSyntax`), `.prettierrc`, `.gitignore`,
`.env.example` (documenté section par section).

## 0.3 — `packages/contracts` : la source de vérité des API

Écrit en premier, parce que tout le reste en dépend. Sept modules :

| Module          | Contenu                                                                |
| --------------- | ---------------------------------------------------------------------- |
| `primitives.ts` | types de stems, statuts, formats d'upload, `S3Key`, `Checksum`         |
| `music.ts`      | accords, temps, signature rythmique, formes d'onde, résultat d'analyse |
| `jobs.ts`       | contrat BFF ↔ ML : création de job, progression, résultat, webhook     |
| `api.ts`        | contrat navigateur ↔ BFF : upload, morceaux, stems, événements SSE     |
| `errors.ts`     | `ErrorCode`, `StemlabError` typée, correspondance avec les codes HTTP  |
| `signature.ts`  | implémentation de référence de la signature HMAC                       |
| `index.ts`      | ré-exports                                                             |

Le schéma de signature retenu : `HMAC-SHA256(secret, "${timestamp}.${corps_brut}")`,
en-têtes `x-stemlab-signature` / `x-stemlab-timestamp`, tolérance 300 s, comparaison
en temps constant. Une seule implémentation, partagée par les deux extrémités, pour
qu'elles ne puissent pas diverger.

25 assertions de test écrites dans la foulée : signature stable, sensible au corps
comme à l'horodatage, rejeu hors fenêtre rejeté, en-têtes manquants rejetés,
validation des clés S3, ordonnancement des suites d'accords.

## 0.4 — `apps/web` : React Router v7 en framework mode

Scaffolding écrit à la main plutôt que généré, pour garder le contrôle du tsconfig et
des plugins. Tailwind v4 via `@tailwindcss/vite`, avec un thème `@theme` définissant
la palette (fond studio sombre, accent cyan) et **une couleur par type de stem** —
ces variables serviront directement au dessin des formes d'onde en phase 1.

Routes : `/` (page d'accueil) et `/health` (sonde sans accès base).

## 0.5 — `apps/ml` : FastAPI + uv

`pyproject.toml` avec séparation nette : les dépendances lourdes (torch, demucs,
essentia) sont derrière l'extra `ml`, pour que la CI et les tests du service n'aient
pas à les installer. `ruff` (avec les règles `S` de bandit) et `mypy --strict`
configurés dès le départ.

Point de résolution : `arq` contraint `redis<6`, alors que `redis>=6.4.0` avait été
déclaré en direct. Dépendance directe retirée — c'est `arq` qui apporte `redis`.

Vérifié : `essentia 2.1b6.dev1389` se résout bien pour Python 3.12.

## 0.6 — Alignement des versions

Les versions initialement supposées étaient toutes périmées. Relevé et corrections :

| Paquet       | Supposé | Réel                         | Décision                                             |
| ------------ | ------- | ---------------------------- | ---------------------------------------------------- |
| react-router | v7      | 7.18.4 (v8.4.0 existe)       | **v7 comme spécifié**, + drapeaux `future` v8        |
| eslint       | ^9.40   | 10.10.0                      | ESLint 10                                            |
| typescript   | ^5.9    | 7.0.2                        | **TS 6.0.3** — typescript-eslint plafonne à `<6.1.0` |
| prisma       | —       | tag `latest` = `8.0.0-rc.15` | **7.10.0** — pas de RC en production                 |
| lucide-react | ^0.552  | 1.47.0                       | 1.x                                                  |
| vite         | ^8.3    | 8.3.0                        | ✅                                                   |

Les cinq drapeaux `future` v8 de React Router ont été activés : l'application adopte
déjà la sémantique v8, et `v8_middleware` servira directement à l'authentification en
phase 4.

## 0.7 — Frictions de l'outillage, et leurs corrections

Six points ont résisté ; tous résolus par exécution, pas par lecture :

1. **pnpm 11** a remplacé `onlyBuiltDependencies` par une carte `allowBuilds`
   explicite, et applique une fenêtre `minimumReleaseAge` qui excluait
   `lucide-react@1.47.0`. Configuration corrigée dans `pnpm-workspace.yaml`.
2. **`@types/node` manquant** dans `contracts` et `audio-engine` → `TS2688`.
3. **TypeScript 6 rejette `baseUrl`** (déprécié). Retiré ; la résolution `~/*` passe
   par `paths` seul, et `vite-tsconfig-paths` a été supprimé au profit de
   `resolve.tsconfigPaths: true`, natif dans Vite 8.
4. **`eslint-plugin-react-hooks@7`** expose encore `configs.recommended` au format
   _eslintrc_ (`plugins` en tableau), rejeté par ESLint 10. La variante plate est
   sous `configs.flat['recommended-latest']`.
5. **Vitest sortait en échec** sur les paquets sans test → `passWithNoTests`.
6. **Turbo avertissait** sur les tâches sans artefact : les scripts `build` de
   `contracts` et `audio-engine` ont été supprimés — ces paquets sont consommés en
   source TypeScript, il n'y a rien à compiler.

## 0.8 — Services locaux sans Docker ni root

C'est la partie qui a demandé le plus d'itérations. Objectif : Postgres, Redis et un
stockage S3 sur les mêmes ports que la stack Docker, sans privilèges.

| Service         | Solution retenue                                   | Pourquoi                                                     |
| --------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| PostgreSQL 17.2 | binaires zonky `embedded-postgres` (Maven Central) | archive relogeable, sans installation                        |
| Redis 8.0.3     | compilé depuis les sources (`make MALLOC=libc`)    | aucun binaire officiel utilisable sans root                  |
| S3              | SeaweedFS 4.47                                     | **MinIO n'est plus téléchargeable** — `dl.min.io` répond 410 |

Cinq obstacles rencontrés, dans l'ordre :

1. **Les binaires zonky n'embarquent ni `psql` ni `createdb`** — seulement `initdb`,
   `pg_ctl` et `postgres`. La base applicative est donc créée par
   `scripts/ensure-db.mjs`, via le client `pg` (qui sera de toute façon requis par
   l'adaptateur Prisma 7).
2. **`ERR_MODULE_NOT_FOUND` sur `pg`** : la résolution ESM part de l'emplacement du
   _fichier_, pas du répertoire courant — changer de `cwd` ne sert à rien avec le
   store isolé de pnpm. `pg` a été ajouté aux dépendances de développement racine.
3. **SeaweedFS refusait de démarrer** : il dérive ses ports gRPC en `port + 10000`,
   soit 69333 pour un master sur 59333 — au-delà de 65535. Les ports gRPC sont
   désormais fixés explicitement en 49xxx.
4. **La création du bucket était un mensonge** : le `curl` initial portait un en-tête
   `Authorization` bricolé, non signé, donc sans effet. Remplacé par
   `scripts/ensure-bucket.mjs`, qui émet une vraie requête SigV4 via
   `@aws-sdk/client-s3`.
5. **Le cycle stop → start échouait** : SeaweedFS met quelques secondes à rendre ses
   ports ; un `start` immédiat croyait le service déjà en place et sautait
   l'initialisation. Ajout d'une attente de fermeture effective, avec repli `kill -9`.

Les trois services ont ensuite été validés par **aller-retour réel** — pas par un
simple test de port :

```
S3 round-trip: bonjour stemlab      (PUT → GET → DELETE signés)
PG: PostgreSQL 17.2 on x86_64-pc-linux-gnu
redis round-trip OK                 (SET → GET → DEL)
```

## 0.9 — Vérification de la Definition of Done

| Critère                      | Résultat                                               |
| ---------------------------- | ------------------------------------------------------ |
| `pnpm dev` lance web + ml    | ✅                                                     |
| `GET /health` → 200 (web)    | ✅ `{"status":"ok","service":"web"}`                   |
| `GET /health` → 200 (ml)     | ✅ `{"status":"ok","service":"ml","model":"htdemucs"}` |
| Page d'accueil rendue en SSR | ✅ HTTP 200, `<h1>` présent dans le HTML               |
| `pnpm format:check`          | ✅                                                     |
| `pnpm lint`                  | ✅ eslint + ruff check + ruff format                   |
| `pnpm typecheck`             | ✅ tsc + mypy strict                                   |
| `pnpm test`                  | ✅ contracts + ml                                      |
| `pnpm build`                 | ✅ bundles client et serveur                           |
| Stack locale complète        | ✅ trois services, aller-retour vérifié                |

**Non vérifié** : `docker compose up` (Docker absent du poste) et l'exécution réelle
de GitHub Actions (nécessite un dépôt distant).

## 0.10 — Note sur le commit

Le premier `git commit` a échoué : la signature GPG configurée globalement attend une
passphrase interactive (`gpg: signing failed: Timeout`), impossible à fournir ici.
La signature a été désactivée **pour ce seul dépôt** (`git config commit.gpgsign
false`) ; la configuration globale n'a pas été touchée. À réactiver si les commits
signés sont attendus sur ce projet.

---

# Phase 1 — Moteur audio multipiste

**2026-09-17** · branche `phase/01-player` · en cours

_(en cours de rédaction — mis à jour au fil des étapes)_

---

# Phase 2 — Pipeline ML en local

**2026-09-17** · branche `phase/02-pipeline`

## 2.1 — Architecture : ce qui est pur, ce qui ne l'est pas

La contrainte « le code ML est pur et testable, les fonctions de traitement ne font
pas d'I/O réseau » a piloté le découpage. Deux modules seulement touchent au monde
extérieur :

| Module          | Rôle                                                           | Pur ?               |
| --------------- | -------------------------------------------------------------- | ------------------- |
| `chords.py`     | gabarits, Viterbi, agrégation par temps, arbitrage de tonalité | ✅                  |
| `beats.py`      | signature rythmique, numérotation des temps, choix de phase    | ✅                  |
| `waveform.py`   | peaks à 512 points/seconde                                     | ✅                  |
| `models.py`     | miroir pydantic des contrats Zod                               | ✅                  |
| `analysis.py`   | Essentia : tonalité, tempo, chromagramme                       | bibliothèque native |
| `separation.py` | Demucs : séparation                                            | torch               |
| `io_audio.py`   | ffmpeg : normalisation, encodage Opus                          | processus externes  |
| `runner.py`     | orchestration                                                  | disque              |

Essentia et Demucs sont importés **paresseusement**. Deux raisons : charger torch
coûte plusieurs secondes et `/health` doit répondre sans, et surtout cela isole la
seule dépendance AGPL derrière une frontière nette — remplacer cet étage ne demande
que de réimplémenter trois fonctions.

## 2.2 — Un allègement de 4 Go

La première installation a téléchargé plus de **4 Go** : les roues PyPI de `torch`
embarquent les bibliothèques CUDA, dont rien n'est utilisable sans GPU. En épinglant
`torch` et `torchaudio` sur l'index `download.pytorch.org/whl/cpu`, l'environnement
descend à **1,2 Go**. Le GPU redevient ce qu'il doit être : une affaire d'image de
déploiement, pas de verrou de dépôt.

## 2.3 — Le bug qui ne se voyait pas

Le premier passage complet a produit des accords **tous transposés**. La sortie
restait parfaitement plausible — une suite d'accords cohérente, juste dans la
mauvaise tonalité.

La cause : la fréquence de référence par défaut du HPCP d'Essentia est 440 Hz, donc
son bin 0 est un **la**, pas un do. La rotation appliquée avait été _déduite_, et
elle était fausse.

La correction n'a pas consisté à raisonner mieux, mais à **mesurer** : faire passer
les douze notes chromatiques dans l'extracteur et relever le bin dominant.

```
  C   (index  0) -> bin  3        A   (index  9) -> bin  0
  C#  (index  1) -> bin  4        A#  (index 10) -> bin  1
  ...                             B   (index 11) -> bin  2
  décalage constant : +3
```

Un test rejoue cette mesure pour chacune des douze notes. C'est le type de bug qui
peut vivre des mois dans un projet : rien ne plante, tout est simplement faux.

## 2.4 — Détection d'accords : trois corrections successives

L'estimateur a été validé d'abord sur du chromagramme **propre** — quatre accords
tenus, temps exacts — où il rend `Am F C G` avec une confiance de 0,97. Le problème
n'était donc pas la reconnaissance, mais le lissage.

**Correction 1 — la netteté des émissions.** Les similarités cosinus sont mal
calibrées comme vraisemblances : l'écart entre un accord juste (1,0) et un accord
proche mais faux (0,87) ne pèse presque rien en logarithme, et le coût de transition
écrase tout. Résultat : une suite Am–F devenait un unique **Fmaj7**, qui contient les
deux. Un exposant (10) appliqué aux scores avant décodage rend les écarts décisifs.

**Correction 2 — décoder par temps, pas par trame.** Le chromagramme est désormais
agrégé par intervalle entre deux temps, par médiane. La médiane écarte les
transitoires percussifs, et le coût de transition prend un sens musical — par temps
plutôt que par tranche de 46 ms. Sur le morceau « électro », le nombre de segments
parasites a chuté d'un facteur trois.

**Correction 3 — le coût de transition n'est pas une probabilité.** La formulation
initiale `log((1 - p) / (n_états - 1))` donnait ≈ 6,8 nats par changement, quelles que
soient les circonstances — assez pour figer la sortie sur un seul accord dès que les
observations se comptent en dizaines plutôt qu'en milliers. Il est maintenant exprimé
comme un coût explicite en nats, avec deux valeurs selon le mode de décodage.

## 2.5 — La tonalité, et pourquoi elle était fausse deux fois sur trois

Une tonalité mineure et son relatif majeur partagent **exactement** la même armure.
Aucun estimateur fondé sur le profil de hauteurs ne peut les séparer — et Essentia
rendait bien le relatif majeur sur les deux morceaux mineurs.

La distinction se fait par l'usage, pas par le contenu. `refine_key_with_chords()`
arbitre a posteriori sur deux indices classiques :

1. l'accord de tonique est le plus joué (durée cumulée) ;
2. une pièce commence et se termine sur sa tonique (premier et dernier accords
   pondérés ×3).

Ce second indice est décisif : `F#m D A E` se lit aussi bien en fa dièse mineur qu'en
la majeur — c'est la même suite, et les deux toniques y sont jouées aussi longtemps.
Seul l'accord de départ tranche.

Tonalités correctes : **3/3**, contre 1/3 avant.

## 2.6 — Résultats mesurés

Trois morceaux synthétisés, dans trois formats, avec vérité terrain connue :

| Morceau        | Format | Tonalité    | Tempo                                   | Accords           |
| -------------- | ------ | ----------- | --------------------------------------- | ----------------- |
| rock (16 s)    | WAV    | ✅ A minor  | ✅ 118,32 (attendu 120,0 — écart 1,4 %) | partiel           |
| électro (15 s) | MP3    | ✅ F# minor | ✅ 127,96 (attendu 128,0)               | ✅ `F#m D A E` ×2 |
| ballade (19 s) | FLAC   | ✅ D major  | ✅ 76,00 (attendu 76,0)                 | racines correctes |

Sur un extrait plus long (128 s), le tempo du morceau « rock » tombe à **120,01 BPM**
exact : l'écart de 1,4 % était un artefact d'échantillon court.

**Accords.** Perfection sur « électro », racines largement correctes sur « ballade »,
bruité sur « rock ». Le réglage s'est arrêté là volontairement : Demucs est entraîné
sur de la musique réelle et répartit du matériel synthétique de façon peu
représentative. Continuer à ajuster contre ces fichiers serait du sur-apprentissage
sur du faux audio.

## 2.7 — Temps de traitement

Mesures sur 16 cœurs CPU (aucun GPU sur ce poste) :

| Entrée                 | Durée   | Traitement | Ratio                 |
| ---------------------- | ------- | ---------- | --------------------- |
| électro                | 15,0 s  | 8,8 s      | **0,58 ×** temps réel |
| rock                   | 16,0 s  | 9,6 s      | **0,60 ×**            |
| ballade                | 18,9 s  | 11,0 s     | **0,58 ×**            |
| rock ×8                | 128,0 s | 47,9 s     | **0,37 ×**            |
| ballade, `htdemucs_6s` | 18,9 s  | 19,4 s     | **1,02 ×**            |

Deux lectures :

- Le ratio **s'améliore** avec la durée (0,58 → 0,37) : les coûts fixes — chargement
  du modèle, mise en route — s'amortissent.
- Le modèle 6 stems coûte environ **1,7 ×** le modèle 4 stems.

**Le temps GPU n'a pas pu être mesuré** : ce poste n'a pas de GPU. Reporté à la phase
9, où le worker Modal (L4) fournira la mesure dans les conditions de production.

## 2.8 — Validation croisée des contrats

Le pipeline sérialise avec pydantic, le BFF validera avec Zod. Rien ne garantit que
les deux décrivent la même chose — sinon un test qui fait passer une vraie sortie de
l'un dans l'autre.

Trois sorties réelles (peaks tronqués à 64 points) sont versionnées dans
`fixtures/analysis/` et validées par `packages/contracts/test/pipeline-output.test.ts`
contre le schéma `PipelineResult`. Le test vérifie aussi des invariants que le schéma
seul ne couvre pas : accords ordonnés et contigus, grille de temps croissante,
positions dans les bornes de la signature, couverture du morceau.

## 2.9 — Definition of Done

| Critère                                  | Résultat                                            |
| ---------------------------------------- | --------------------------------------------------- |
| `uv run python -m ml.pipeline <fichier>` | ✅ CLI complète avec progression et résumé          |
| Stems + `analysis.json` valides          | ✅ validés par Zod depuis le côté TypeScript        |
| Sur trois morceaux de styles différents  | ✅ rock / électro / ballade, en WAV / MP3 / FLAC    |
| Normalisation ffmpeg (44,1 kHz)          | ✅ testée depuis WAV, MP3 et mono                   |
| Stems en Opus 96 kb/s                    | ✅ `--keep-wav` en option                           |
| Accords sur `bass + other` remixés       | ✅ agrégés par temps, lissés, alignés sur la grille |
| Peaks à 512 points/seconde dans le JSON  | ✅ mix et chaque stem                               |
| Durée mesurée et consignée (CPU)         | ✅ 0,37 à 0,60 × temps réel selon la durée          |
| Durée mesurée et consignée (GPU)         | ❌ **aucun GPU sur ce poste** — reporté en phase 9  |

**Tests** : 106 côté Python (dont 17 d'intégration Essentia), 42 côté contrats.
`ruff` et `mypy --strict` propres.
