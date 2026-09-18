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

---

# Phase 3 — Service de jobs

**2026-09-17** · branche `phase/03-jobs`

## 3.1 — La frontière qui structure tout

Une seule règle de conception commande cette phase :

> Le worker ne touche **jamais** la base de données. Il lit l'original sur S3, écrit
> les stems sur S3, et rend son résultat au BFF par un webhook signé.

C'est ce qui permettra, en phase 9, de déplacer le worker sur un GPU serverless sans
rien changer ailleurs : il n'a besoin ni d'accès réseau privilégié, ni de secret de
base de données, ni de connaître le schéma. Il a besoin d'un bucket et d'une URL.

## 3.2 — Deux implémentations d'une même signature

La signature HMAC existe désormais en TypeScript **et** en Python. Chacune peut passer
ses propres tests tout en étant incompatible avec l'autre — un encodage UTF-8
différent, un espace de sérialisation, et tout le canal interne tombe en silence.

`fixtures/signature-vectors.json` contient sept triplets
`(secret, corps, horodatage) → signature`, couvrant :

- un corps vide ;
- de l'UTF-8 hors ASCII (`{"titre":"Été à Paris — été"}`) ;
- un corps de 4 Ko ;
- des guillemets et antislashs échappés ;
- des sauts de ligne dans le secret.

Les deux suites les vérifient. Si les deux passent, les deux implémentations
concordent — ce qu'aucun test purement local ne peut établir.

## 3.3 — Redis porte trois choses, pas une

Le même module regroupe trois responsabilités, parce qu'elles partagent la convention
de clés :

| Rôle          | Clé                                    | Durée de vie                                               |
| ------------- | -------------------------------------- | ---------------------------------------------------------- |
| Progression   | `stemlab:job:{id}`                     | 24 h — assez pour interroger, trop peu pour servir de base |
| Idempotence   | `stemlab:checksum:{modèle}:{checksum}` | 30 jours — c'est ce qui évite de repayer du GPU            |
| File de rebut | `stemlab:dlq`                          | bornée à 1000 entrées                                      |

Le **modèle fait partie de la clé d'idempotence** : le même fichier séparé en six
stems n'est pas le même résultat qu'en quatre.

En cas de doublon, le webhook de succès est **rejoué à l'identique** plutôt que
remplacé par une réponse « déjà fait ». Le BFF reçoit exactement ce qu'il aurait reçu
d'un vrai traitement, et n'a donc qu'un seul chemin de code à écrire.

## 3.4 — Ce qui a résisté

**Le worker refusait de démarrer.** `WorkerSettings.redis_settings` doit être une
_instance_ de `RedisSettings`, pas une méthode — ARQ lit l'attribut directement.
Erreur peu lisible : `'staticmethod' object has no attribute 'host'`.

**Une erreur 400 renvoyait une 500.** `ValidationError.errors()` inclut par défaut un
contexte qui porte l'objet `ValueError` d'origine, non sérialisable en JSON. Le
service échouait en tentant de décrire l'échec. Les erreurs sont désormais ramenées à
la forme `{champ: [messages]}` des contrats, sans contexte ni entrée — ce qui évite
aussi de faire du service un écho pour qui le sonde.

**Les tests ne pouvaient pas partager Redis.** `TestClient` exécute l'application dans
sa propre boucle d'événements ; un client Redis asynchrone y est lié et ne peut pas
être réutilisé depuis la boucle du test. La solution n'est pas de partager le client
mais le **serveur** : `FakeServer` porte les données, chaque boucle a son client. Ce
qui reproduit d'ailleurs fidèlement la réalité — le worker tourne dans un autre
processus.

## 3.5 — Vérification de bout en bout

Stack complète lancée : Redis, S3, API, worker ARQ, et un receveur de webhook qui
vérifie la signature exactement comme le fera le BFF.

**1. Un vrai job, déposé par `curl` signé**

```
POST /jobs → 202 Accepted
{"jobId":"dfc27f84-…","status":"queued","deduplicated":false}

  [  2%] normalisation
  [ 57%] separation
  [ 78%] encodage
  [100%] termine
  [SUCCES] 4 stems | F# minor | 127.96 BPM | 9 accords | 14.92 s
```

Les quatre stems sont bien dans S3, sous le préfixe demandé.

**2. Idempotence** — même corps reposté :

```
{"jobId":"68c24ac9-…","status":"succeeded","deduplicated":true}
```

Le webhook de succès est rejoué à l'identique, et le journal du worker ne montre
**aucun** nouveau traitement.

**3. Échec** — clé source inexistante :

```
[ECHEC] not_found : objet introuvable : tracks/inexistant/rien.mp3 (rejouable : False)
```

Pas de reessai — un objet absent ne réapparaîtra pas — et le job part en file de
rebut.

**4. Redémarrage du worker en cours de traitement**

Un morceau de 128 s est lancé, puis le worker reçoit `SIGTERM` à 10 % :

```
22:31:35: shutdown on SIGTERM ◆ 1 jobs complete ◆ 1 ongoing to cancel
22:31:35:  51.50s ↻ d008120e-…:process_track cancelled, will be run again
```

Un worker neuf est démarré. Le job **reprend à l'essai 2** et se termine :

```
running|10|2|separation  →  running|62|2|analyse  →  succeeded|100|2|termine
[SUCCES] 4 stems | A minor | 120.01 BPM | 80 accords | 53.1 s
```

Aucune perte. C'est le comportement voulu pour un worker GPU en _scale-to-zero_ :
remettre en file immédiatement plutôt que bloquer l'arrêt jusqu'à dix minutes.

## 3.6 — Definition of Done

| Critère                           | Résultat                                       |
| --------------------------------- | ---------------------------------------------- |
| `POST /jobs`, `GET /jobs/{id}`    | ✅ + `/dead-letters`, `/ready`                 |
| Progression incrémentale          | ✅ état Redis + webhooks, par pas de 10 points |
| Reessais avec recul               | ✅ 5 s puis 20 s, trois essais                 |
| Timeout                           | ✅ 600 s, aligné sur le plafond Modal          |
| File de rebut                     | ✅ bornée à 1000 entrées                       |
| Webhook signé HMAC                | ✅ vecteurs partagés entre les deux langages   |
| Idempotence par checksum          | ✅ clé `(checksum, modèle)`                    |
| Job de bout en bout depuis `curl` | ✅                                             |
| Échec simulé remonté              | ✅                                             |
| Redémarrage sans perte            | ✅                                             |

**Tests** : 205 Python (dont 16 sur la machine à états du worker), 58 contrats.

---

# Phase 4 — Auth, upload, bibliothèque

**2026-09-18** · branche `phase/04-library`

## 4.1 — Le parcours à construire

Inscription → dépôt d'un fichier → traitement → lecture multipiste → suppression.
Tout le reste de la phase découle de cette chaîne.

Deux principes tiennent l'architecture :

1. **L'audio ne transite jamais par l'application.** Le navigateur envoie et récupère
   les fichiers directement sur le stockage objet, par URL présignée. Le serveur ne
   fait que signer. C'est ce qui permet d'accepter 100 Mo sans dimensionner le serveur
   pour.
2. **Le BFF est le seul écrivain de la base.** Le worker rend ses résultats par
   webhook signé ; aucune autre porte d'entrée.

## 4.2 — Le bug qui a coûté le plus cher

Tout `PUT` vers une URL présignée était rejeté. `BadDigest` côté SeaweedFS. J'ai
soupçonné l'implémentation S3 locale, téléchargé une alternative (Garage), monté un
cluster complet, créé clés et bucket — pour découvrir **la même famille d'erreur** :
`InvalidDigest ... algorithm Crc32`.

C'est ce second message qui a donné la réponse : depuis fin 2024, le SDK AWS v3 joint
un checksum CRC32 à chaque envoi. Sur une URL présignée, la signature exige alors un
en-tête que le navigateur ne produit pas.

```
defaut-sdk             PUT -> 400 BadDigest
checksum-si-requis     PUT -> 200 | GET -> 200 361787 o IDENTIQUE
```

Une ligne de configuration (`requestChecksumCalculation: 'WHEN_REQUIRED'`) et
SeaweedFS fonctionnait parfaitement. La migration était inutile, et Garage a été
retiré.

**Ce que j'en retiens :** quand deux implémentations indépendantes échouent de la même
façon, l'erreur est dans le code appelant. J'aurais dû réessayer la première avec le
correctif avant d'en installer une seconde.

## 4.3 — Trois bugs que seul le parcours complet pouvait révéler

**Un clic avant l'hydratation.** Le test de bout en bout échouait par intermittence à
l'inscription. Le clic arrivait avant que React n'ait attaché son gestionnaire : le
formulaire partait en soumission native. Ce n'était pas un défaut du test — c'est ce
que vit un utilisateur sur une connexion lente. L'inscription et la connexion sont
passées en **actions serveur** : plus de course, et les deux formulaires fonctionnent
sans JavaScript.

**Un morceau bloqué en file.** Le service ML rejoue le webhook de succès _pendant_
l'appel de création de job. Le morceau passait donc à `ready`, puis la transaction qui
suivait le remettait à `queued`. Le statut est désormais posé **avant** l'appel, par
une mise à jour conditionnelle qui n'écrase jamais un statut plus avancé.

**Des stems appartenant à quelqu'un d'autre.** Le cache d'idempotence rendait des clés
pointant vers le préfixe du _premier_ traitement. Le demandeur recevait des fichiers
qu'il ne possède pas, et que la suppression de l'autre morceau ferait disparaître sous
ses pieds. À la déduplication, les stems sont maintenant recopiés côté stockage sous
le préfixe demandé — infiniment moins cher qu'une séparation GPU.

**Un worker sans torch.** `ModuleNotFoundError: torch` alors que torch était installé :
`uv run` resynchronise l'environnement à chaque appel et retire un extra non demandé
sur cette ligne. Les dépendances lourdes sont passées d'un extra à un **groupe par
défaut**.

## 4.4 — Restructuration du monorepo

Trois demandes en cours de phase, toutes appliquées :

| Avant                         | Après                                                          |
| ----------------------------- | -------------------------------------------------------------- |
| Prisma dans `apps/web`        | **`packages/database`** — schéma, migrations, client, fabrique |
| Composants UI dans `apps/web` | **`packages/ui`** — shadcn/ui et thème partagé                 |
| Routes à plat, en français    | `routes/{auth,dashboard,api}/`, nommées en anglais             |

**`@stemlab/database`** ne lit pas l'environnement : la chaîne de connexion lui est
passée par l'application, qui l'a déjà validée. Une configuration incomplète échoue au
démarrage, pas au premier accès à la base.

**`@stemlab/ui`** adopte shadcn/ui pour de bon — composants générés par la CLI, jetons
sémantiques, variante `dark`. Deux choses nous restent propres dans la feuille de
style : la couleur de marque, et **une couleur par type de stem**, lue directement par
le canvas des formes d'onde. L'interface et le tracé ne peuvent donc pas diverger.

Point d'attention : `accent` est un jeton réservé par shadcn. Le cyan de STEMLAB a été
renommé `brand`, et `--primary` pointe dessus.

**Les routes** sont en anglais, URL comprises (`/login`, `/signup`, `/library`,
`/tracks/:id`). Les textes affichés restent en français : c'est la langue du produit,
pas celle du code.

## 4.5 — Le flux d'état, et pourquoi il interroge la base

La bibliothèque suit l'avancement sans rechargement. Le flux SSE **relit la base**
toutes les 1,5 s et n'émet que les changements, plutôt que de s'appuyer sur un bus en
mémoire.

Ce choix mérite d'être explicite : le webhook du worker peut atterrir sur une instance
et le flux vivre sur une autre — ce sera le cas dès le déploiement multi-région de la
phase 9. Un bus en mémoire laisserait alors l'utilisateur devant une barre figée. Une
requête indexée coûte moins cher qu'un bus distribué, et reste correcte quelle que
soit la topologie.

## 4.6 — Definition of Done

Le test `e2e/journey.spec.ts` enchaîne le parcours complet contre la stack réelle —
base, stockage objet, service ML et worker :

| Étape            | Vérification                                                           |
| ---------------- | ---------------------------------------------------------------------- |
| Inscription      | ✅ compte créé, session posée, redirection vers la bibliothèque        |
| Dépôt direct     | ✅ `init` → `PUT` présigné → `complete`, sans passer par l'application |
| Validation       | ✅ un fichier texte est refusé sans quitter la page                    |
| Traitement       | ✅ **job réel** : 8,7 s pour 15 s d'audio, 4 stems                     |
| Suivi en direct  | ✅ passage à « Prêt » sans rechargement, par SSE                       |
| Analyse affichée | ✅ tonalité et tempo remontés par le webhook                           |
| Lecture          | ✅ 4 pistes chargées, transport fonctionnel, position qui avance       |
| Suppression      | ✅ morceau et objets S3 retirés                                        |

**Suite complète : 30 tests E2E verts**, sur deux formats dont 390 px, dont deux
parcours complets avec traitement ML réel.

Le test de dérive audio a par ailleurs été rendu tolérant à la charge : il
échantillonnait pendant une durée fixe, ce qui échouait quand huit workers Playwright
et un job ML se disputaient la machine. Il attend désormais que la lecture ait franchi
deux secondes — même propriété vérifiée, sans hypothèse sur la vitesse de la machine.
