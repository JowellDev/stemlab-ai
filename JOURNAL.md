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

---

# Phase 5 — Accords, tonalité, tempo

**2026-09-18** · branche `phase/05-chords`

## 5.1 — L'idée qui rend le reste facile

La position rendue par le lecteur est exprimée **dans le temps du morceau**, pas en
temps réel écoulé :

```
position = offset + écoulé × vitesse
```

À 75 %, quatre secondes d'horloge donnent trois secondes de morceau. La position est
donc toujours dans le référentiel de l'analyse — celui où vivent les accords et les
temps. Aucun réalignement n'est nécessaire quand le tempo change, et c'est exactement
ce que vérifie la _Definition of Done_.

## 5.2 — `packages/music`

Transposition, orthographe des hauteurs, recherche de l'élément actif, construction de
la grille : un paquet pur, sans React ni Web Audio.

| Module         | Rôle                                                       |
| -------------- | ---------------------------------------------------------- |
| `spelling.ts`  | dièses ou bémols selon l'armure                            |
| `transpose.ts` | libellés d'accords et tonalité                             |
| `lookup.ts`    | recherche dichotomique de l'accord, du temps, de la mesure |
| `bars.ts`      | grille de mesures et répartition des accords               |

**58 tests**, aucun simulacre.

Deux points méritent d'être notés :

**Rien n'est recalculé depuis l'audio pour transposer.** La fondamentale de chaque
accord est déjà connue ; il suffit de la décaler. Une transposition est donc
instantanée et ne peut pas désaligner quoi que ce soit.

**L'orthographe suit l'armure obtenue.** Transposer ré majeur d'un demi-ton donne mi
bémol majeur : écrire `D#` y serait faux. Un test écrit naïvement a d'ailleurs échoué
sur ce point — c'est l'application qui avait raison, pas le test.

## 5.3 — La grille était décalée d'une demi-mesure

Le premier rendu à l'écran l'a montré tout de suite : les accords tombaient au milieu
des cases.

La cause n'était pas dans l'affichage. La phase des temps forts venait de l'énergie
par temps — et sur un morceau électronique en quatre-à-la-noire, tous les temps ont la
même énergie. L'heuristique n'avait rien pour trancher, et retombait sur « le premier
temps détecté est un temps fort », ce qui était faux ici.

**Correction dans le pipeline.** La grille est désormais construite **après** la
détection d'accords, et la phase retenue est celle qui place le plus de changements
d'accord sur un temps fort. Une harmonie change presque toujours sur un temps fort ;
c'est un indice nettement plus fiable que l'énergie, qui reste le repli.

Résultat sur la ballade : premier temps fort à 3,135 s, exactement sur un changement
d'accord.

## 5.4 — Deux vues, un même lecteur

**Grille** — quatre mesures par ligne, l'accord au centre, la mesure courante mise en
avant. C'est la vue d'un musicien qui joue.

**Ligne de temps** — largeur proportionnelle à la durée : on lit d'un coup d'œil qu'un
accord tient quatre temps et le suivant deux.

Le lecteur a dû être **remonté d'un cran** : il appartient maintenant à
`TrackWorkspace`, que la grille d'accords et les pistes partagent. Elles lisent la
même horloge, elles ne peuvent donc pas diverger. La partie présentationnelle du
lecteur a été extraite dans `PlayerControls`, ce qui laisse la page de vérification du
moteur inchangée.

**Aucune de ces vues ne passe par l'état React pour suivre la lecture.** La recherche
tourne à chaque frame — c'est une dichotomie, négligeable — mais le rappel n'est
déclenché que lorsque l'élément actif _change_. Un accord durant plusieurs secondes,
cela fait une notification pour trois cents frames muettes. Le défilement suit les
changements d'accord, pas chaque frame : un recentrage continu donnerait un mouvement
flottant.

## 5.5 — Pilotage de la vitesse

`MultitrackPlayer.setPlaybackRate()` agit sur le `playbackRate` des sources. Cette
implémentation déplace aussi la hauteur — la phase 6 la remplacera par un AudioWorklet
SoundTouch qui dissocie les deux, sans changer l'API.

Le point délicat : **l'horloge doit être ré-ancrée** sur la position courante au
moment du changement. Sans cela, tout le temps déjà écoulé serait réinterprété à la
nouvelle vitesse et la position ferait un saut. Un test le vérifie explicitement.

## 5.6 — Trois défauts trouvés par l'exécution

**Une revalidation pendant le rendu.** La bibliothèque appelait `revalidate()` dans le
corps du composant. React le signale : _« Cannot update a component while rendering a
different component »_. Déplacé dans un effet.

**Les boutons de vue perdaient leur nom sous 640 px.** Leur libellé vit dans un
`<span class="hidden sm:inline">` : à 390 px, ils n'avaient plus **aucun** nom
accessible. C'est le test mobile qui l'a révélé.

**Les curseurs n'avaient pas de nom du tout.** Dans un slider Radix, c'est la
_poignée_ qui porte le rôle `slider`, pas la racine : un `aria-label` posé sur le
composant n'atteint aucune technologie d'assistance. Le composant partagé expose
désormais `thumbLabel`.

## 5.7 — Definition of Done

La propriété vérifiée est la même dans tous les cas, et elle est auto-référente :
**l'accord mis en avant doit contenir la position de lecture dans ses propres
bornes**. Chaque accord porte son intervalle ; le test n'a donc rien à supposer.

| Critère                              | Vérification                                     |
| ------------------------------------ | ------------------------------------------------ |
| Accords synchronisés à la lecture    | ✅ dès le démarrage                              |
| Alignement après seek                | ✅ quatre positions successives                  |
| Alignement après changement de tempo | ✅ à 75 % puis 125 %                             |
| Alignement après transposition       | ✅ bornes inchangées, seul le libellé change     |
| Grille de mesures                    | ✅ calée sur les changements d'accord            |
| Tonalité et BPM en en-tête           | ✅ valeurs **entendues**, pas analysées          |
| Transposition des libellés           | ✅ décalage uniforme, orthographe selon l'armure |
| Défilement automatique               | ✅ sur changement d'accord ou de mesure          |
| Vue grille et vue ligne de temps     | ✅                                               |
| Mobile 390 px                        | ✅ suite complète verte sur ce format            |

**48 tests E2E verts** au total, desktop et mobile.

---

# Phase 6 — Pitch et tempo

**2026-09-18** · branche `phase/06-pitch-tempo`

## 6.1 — La spécification demandait une chose qui n'existe pas

« SoundTouch compilé en WASM dans un AudioWorklet (licence LGPL — lien dynamique) ».

Trois constats, dans l'ordre où ils sont apparus :

1. **Aucun portage WASM de SoundTouch n'est publié.** `soundtouchjs` et
   `soundtouch-ts` sont des réécritures en JavaScript. Obtenir du WASM demanderait de
   compiler le C++ avec Emscripten — absent de la machine — et d'entretenir cette
   chaîne.
2. **Le « lien dynamique » ne tient pas.** Un module WASM empaqueté dans un _bundle_
   navigateur est un lien statique déguisé. L'exigence de la LGPL serait au mieux
   discutable — et c'est exactement le souci de licence qui avait fait écarter Rubber
   Band.
3. **Un portage JavaScript ne tiendrait pas la DoD.** Étirer six flux stéréo par
   tranches de 128 échantillons, sans accroc, demande du code natif.

**Signalsmith Stretch** (MIT, WASM, AudioWorklet fourni, lecture depuis tampon
fournie) satisfait _les deux_ intentions de la spécification — du WASM, pas de
licence contaminante — mieux que ce qu'elle nommait.

## 6.2 — Le bénéfice qu'on n'avait pas vu venir

Le nœud accepte _n_ canaux et les étire **ensemble**, sous une analyse unique.

Toutes les pistes deviennent donc les canaux d'un seul nœud. La dérive entre pistes
cesse d'être une propriété à surveiller : elle est **structurellement impossible**,
les canaux n'étant même pas suivis séparément.

Avec SoundTouch — limité à deux canaux — il aurait fallu _n_ instances, et prouver
qu'elles restent verrouillées. Ici il n'y a rien à prouver : il n'y a qu'une horloge.

## 6.3 — Trois heures perdues sur un paramètre

Le nœud s'instanciait. Il acceptait ses tampons. Il acceptait sa planification. Et il
ne produisait rien — `inputTime` figé à zéro.

Diagnostic en isolant les variables une à une :

| entrées | canaux | résultat   |
| ------- | ------ | ---------- |
| 1       | 2      | ✅         |
| 0       | 2      | ❌ silence |
| 1       | 8      | ✅         |
| 0       | 8      | ❌ silence |

Chrome n'exécute pas le `process()` d'un `AudioWorkletNode` déclaré **sans entrée**,
même lorsque ce nœud est une source. Une entrée déclarée et laissée non connectée
suffit.

C'est le genre de panne où le premier réflexe — « le problème vient du nombre de
canaux » — est faux, et où seule la variation systématique donne la réponse.

## 6.4 — Un moteur, deux implémentations

Le lecteur ne produit plus le son : il délègue à un `PlaybackEngine`.

|                  | `StretchEngine`        | `BufferSourceEngine`      |
| ---------------- | ---------------------- | ------------------------- |
| Mécanisme        | nœud WASM, tous canaux | une source par piste      |
| Tempo et hauteur | **indépendants**       | liés, comme une bande     |
| Sync             | structurelle           | instant de départ partagé |
| Rôle             | chemin principal       | repli                     |

Le repli existe parce qu'un AudioWorklet peut échouer à se charger — navigateur
ancien, politique de sécurité bloquant le `Blob:` du module, WASM refusé. Mieux vaut
une lecture dégradée qu'aucune lecture ; et l'interface le **dit**, plutôt que de
laisser un curseur sans effet.

Le lecteur, lui, garde l'horloge, le transport, le mixage et les événements. C'est
cette séparation qui a permis de remplacer toute la mécanique d'étirement sans
toucher à la logique de lecture.

**Un détail qui aurait tout décalé.** Le nœud compense sa propre latence et exige une
avance d'environ 250 ms, là où le lecteur en prévoyait 80. Démarrer plus tard que
l'horloge ne le croit aurait produit un décalage permanent entre la position affichée
et ce qu'on entend. Le moteur déclare donc son besoin (`startLead`), et le lecteur
retient le maximum des deux.

## 6.5 — Mesurer la dérive

Le banc (`/dev/drift`) rend l'audio dans un `OfflineAudioContext`, **à travers le
vrai moteur de l'application**. Chaque piste reçoit des impulsions aux mêmes
instants ; après étirement, leurs positions doivent coïncider à l'échantillon près.

Cinq minutes d'audio se rendent en une trentaine de secondes, et le chemin vérifié
est celui de la production — pas une reconstitution.

| Réglage              | Entrée    | Sortie | Événements | Écart max         |
| -------------------- | --------- | ------ | ---------- | ----------------- |
| 75 %, −3 demi-tons   | 30 s      | 44 s   | 9          | **0 échantillon** |
| 75 %, −3 demi-tons   | **300 s** | 404 s  | 99         | **0 échantillon** |
| 50 %, +12 demi-tons  | 20 s      | 44 s   | —          | **0 échantillon** |
| 150 %, −12 demi-tons | 20 s      | 17 s   | —          | **0 échantillon** |

Une première version du banc, parallélisée, échouait par épuisement mémoire — cinq
minutes sur huit canaux occupent plus de 500 Mo, et le rendu sortait **silencieux**
plutôt que d'échouer franchement. Les mesures s'exécutent désormais en série.

## 6.6 — Les tests de synchronisation changent d'objet

`sync.spec.ts` instrumentait `AudioBufferSourceNode.start()` pour vérifier que les
quatre pistes recevaient le même instant. Ce mécanisme n'existe plus sur le chemin
principal.

Le fichier vérifie désormais ce qui reste observable de l'extérieur :

- **aucune** source de tampon n'est créée — preuve que le moteur d'étirement tourne ;
- la position est exacte après chaque seek ;
- l'écart entre horloge audio et position affichée reste constant.

La garantie inter-pistes, elle, a changé de nature : mesurée par `drift.spec.ts`,
garantie par construction. Les tests unitaires du moteur de repli continuent de
vérifier l'instant partagé, qui reste sa propriété à lui.

## 6.7 — Definition of Done

| Critère                                              | Résultat                                              |
| ---------------------------------------------------- | ----------------------------------------------------- |
| Étirement WASM dans un AudioWorklet                  | ✅ Signalsmith Stretch (MIT) — voir l'écart documenté |
| Hauteur ±12 demi-tons                                | ✅ testée aux bornes                                  |
| Tempo 50–150 %                                       | ✅ testé aux bornes                                   |
| Tempo et hauteur indépendants                        | ✅ `supportsIndependentPitch`                         |
| Appliqué identiquement à toutes les pistes           | ✅ un seul nœud, une seule analyse                    |
| **Aucune dérive après 5 min à 75 % et −3 demi-tons** | ✅ **0 échantillon**                                  |
| Licence documentée                                   | ✅ MIT — la contrainte LGPL disparaît                 |

**Tests** : 115 unitaires (`@stemlab/audio-engine`), 56 E2E sur deux formats.

**Non vérifié** : l'absence d'accroc audio « sur un processeur de milieu de gamme »
ne peut pas être constatée ici — l'environnement n'a pas de sortie audio. Le rendu
hors-ligne prouve la justesse du traitement, pas la tenue en temps réel sous charge.

---

# Phase 7 — PWA et hors-ligne

## 7.1 — Ce que « hors-ligne » veut dire ici

Un morceau déjà traité doit se lire **intégralement** en mode avion : les quatre
pistes, la grille d'accords, le tempo et la hauteur indépendants, le déplacement de
la tête de lecture. Autrement dit, les octets audio doivent être sur l'appareil, pas
seulement la page.

Trois pièces, donc : un stockage local qui tienne des dizaines de mégaoctets, un
service worker qui serve la page du morceau sans réseau, et un moyen pour le lecteur
de lire ces octets comme s'ils venaient du serveur.

## 7.2 — OPFS plutôt qu'IndexedDB

Les stems font quelques mégaoctets chacun. L'_Origin Private File System_ les
conserve comme de vrais fichiers, sans sérialisation, et les range en répertoires —
supprimer un morceau devient un seul appel. IndexedDB aurait imposé d'empaqueter des
blobs dans une base clé-valeur pour le même service, en moins direct.

`packages/offline` isole cette logique derrière une interface étroite, `FileStorage`.
L'intérêt n'est pas l'abstraction pour elle-même : c'est que l'éviction, le budget et
la cohérence du manifeste se testent sans navigateur, avec une implémentation en
mémoire, donc vite et sans simuler une API dont on ne maîtrise pas le comportement.

Le manifeste vit **dans le stockage lui-même**. S'il vivait dans IndexedDB, vider le
site effacerait les fichiers sans effacer leur description : le manifeste décrirait
des morceaux injouables.

## 7.3 — Le budget et un défaut de comptage

`OfflineStore` s'impose 2 Gio, et refuse d'approcher le quota réel de moins de
50 Mio. Quand la place manque, les morceaux les moins récemment lus partent d'abord.

Un défaut est apparu au test : réenregistrer un morceau déjà stocké comptait sa
taille **en plus** de celle qu'il occupait déjà, et l'éviction se déclenchait pour
rien. La correction tient en une ligne — retrancher la taille remplacée :

```ts
const replaced = manifest.tracks[protectedId]?.bytes ?? 0
const delta = needed - replaced
```

## 7.4 — Faire lire le lecteur depuis le disque

Le lecteur attend des URL. Plutôt que de lui apprendre deux modes, on lui donne des
URL d'un schéma à nous — `stemlab-offline:<trackId>/<stem>` — et un `fetch` qui les
résout depuis le stockage. Le reste du moteur ignore tout de la question.

## 7.5 — Le service worker, et deux erreurs de routage

`vite-plugin-pwa` en mode `generateSW`. La page d'un morceau est mise en cache à la
visite (`NetworkFirst`, cache `pages`), le WASM d'étirement est précaché — sans lui,
la lecture hors-ligne perdrait tempo et hauteur indépendants.

**Première erreur.** `navigateFallback` enregistre sa route **avant** les règles de
`runtimeCaching`, et Workbox retient la première route qui correspond. Hors ligne,
toute navigation retombait donc sur la page d'attente, y compris celle d'un morceau
présent dans le cache. La route de repli est désormais neutralisée
(`navigateFallbackDenylist: [/./]`) et le repli recâblé **après** la tentative réseau
puis le cache, via `precacheFallback`.

**Seconde erreur, cachée par la première.** `navigateFallback` ne précache pas la page
qu'il désigne : il la suppose déjà présente dans le manifeste — ce qui est vrai d'un
`index.html` de build, faux d'une route rendue par le serveur. La page de repli
n'était donc dans aucun cache, et la navigation hors ligne échouait sans rien dire.

## 7.6 — La page de repli devient statique

Servir le HTML d'une route React Router sous une **autre** URL casse l'hydratation :
le client compare ce HTML à la route demandée et bascule sur la frontière d'erreur —
« Une erreur est survenue » au lieu de « Hors connexion ».

`public/offline.html` est donc une page statique : aucun script, aucune requête,
précachée comme un fichier ordinaire. C'est précisément ce qu'on attend d'un repli
hors ligne.

## 7.7 — Un faux diagnostic, corrigé

Pendant l'enquête, `page.reload()` échouait en `ERR_INTERNET_DISCONNECTED` là où un
`location.reload()` déclenché dans la page semblait passer. J'en ai conclu que
Playwright contournait le service worker, et j'ai écrit un contournement.

C'était faux. Les deux échouaient ; seul `page.reload()` **remontait** l'échec. Une
fois la page de repli réellement précachée, `page.reload()` fonctionne, et le
contournement — ainsi que le commentaire qui l'expliquait — a été supprimé.

## 7.8 — La file d'envoi différée

Un fichier déposé sans réseau n'est pas perdu : il est écrit dans le même stockage
local, listé sous le sélecteur, et reparti tout seul au retour de la connexion.
L'événement `online` est le seul déclencheur — un minuteur réveillerait l'appareil
pour rien la plupart du temps.

La distinction qui compte est celle entre un échec **transitoire** et un **refus**.
Un refus du serveur (format, taille, quota) retire l'envoi de la file : le réessayer
donnerait le même refus. Un échec réseau arrête la boucle sans rien jeter — si un
envoi ne passe pas, les suivants ne passeront pas davantage.

## 7.9 — Un `change` ne se rejoue pas

Deux tests échouaient par intermittence : le fichier déposé n'était jamais pris en
compte. Le HTML rendu par le serveur est complet et cliquable **avant** l'hydratation,
mais ses gestionnaires n'existent pas encore. Playwright rejoue un clic émis trop tôt ;
il ne rejoue pas un `change`, qui est perdu sans rien laisser paraître.

`<html data-hydrated>` marque le moment où React a pris la main, et les tests
attendent ce marqueur avant toute interaction non rejouable. Le même piège avait déjà
frappé les formulaires d'authentification en phase 4, où la parade avait été de les
convertir en actions serveur.

## 7.10 — Inter, servie par l'application

L'audit a montré une feuille de style bloquante sur `fonts.googleapis.com`. Deux
sous-ensembles latins (130 Ko) sont désormais servis par l'application et précachés :
une dépendance tierce de moins, et l'interface garde sa police hors ligne.

## 7.11 — Definition of Done

| Critère                                                  | Résultat                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| Manifeste et application installable                     | ✅ vérifié sur le build de production                             |
| Icônes 192/512 + maskable                                | ✅ servies, dimensions vérifiées                                  |
| Service worker enregistré et actif                       | ✅                                                                |
| **Un morceau téléchargé se lit en mode avion**           | ✅ lecture **et** déplacement de la tête, réseau réellement coupé |
| Un morceau non téléchargé ne prétend pas être disponible | ✅ page de repli, aucun bouton de lecture                         |
| File d'envoi différée                                    | ✅ mise en attente sans réseau, reprise automatique               |
| Mobile 390 px                                            | ✅ 58 tests E2E dont un format 390 px complet                     |

**Tests** : 61 unitaires (`@stemlab/offline`), 58 E2E sur trois formats.

**Lighthouse** (build de production, mobile 390 px) : performance 97, accessibilité
100, bonnes pratiques 100, SEO 100.

**Non vérifié**

- **Le score « PWA » ≥ 90 demandé par la spécification** : la catégorie PWA a été
  retirée de Lighthouse à partir de la version 12. Les critères qu'elle agrégeait
  sont vérifiés un à un par `e2e/offline.spec.ts`.
- **L'installation sur Chrome Android et Safari iOS** : aucun appareil ni émulateur
  ici. À constater avant la mise en production.

---

# Phase 8 — Durcissement

## 8.1 — Les quotas comptent le calcul, pas le stockage

Le plan gratuit permet cinq morceaux par mois et quatre pistes ; le plan payé
lève la limite et ouvre la séparation en six pistes.

Le comptage porte sur les morceaux **créés** dans le mois, pas sur ceux présents.
Supprimer un morceau ne rend pas son crédit : autrement la limite ne limiterait
que le stockage, alors que c'est le calcul — quelques minutes de CPU ou de GPU —
qui coûte. À l'inverse, redéposer un fichier déjà connu ne consomme rien,
puisqu'il ne relance aucun calcul.

La consommation est affichée en permanence sous le sélecteur de fichier. Une
limite qu'on découvre en s'y heurtant passe pour une panne.

## 8.2 — Une fenêtre fixe, dans Redis

La limitation de débit utilise une fenêtre fixe : deux commandes Redis, aucun
état à maintenir, et un comportement explicable en une phrase. Son défaut connu
— jusqu'à deux fois la limite à cheval sur deux fenêtres — est sans conséquence
quand il s'agit d'écarter des abus plutôt que de facturer à l'appel près.

Le compteur vit dans Redis parce que l'application tournera en plusieurs
instances : un compteur local diviserait silencieusement la limite par le nombre
de machines. Quand Redis ne répond pas, la limitation retombe sur un compteur
local et **laisse passer** : une protection qui tombe en panne ne doit pas fermer
le service qu'elle protège.

L'identité limitée est l'utilisateur quand il est connu, l'adresse sinon. Limiter
par adresse seule punirait tout un réseau d'entreprise pour un seul abus.

## 8.3 — Trois pièges d'une politique de contenu

La CSP est nominative — un `nonce` par requête — plutôt que permissive : un
`'unsafe-inline'` sur les scripts rendrait la directive décorative, puisque c'est
exactement ce qu'exploite une injection. Trois obstacles, tous instructifs.

**Un nonce annule `'unsafe-inline'`.** En développement, Vite injecte ses propres
scripts en ligne ; la politique les acceptait en théorie et les bloquait en
pratique, parce que le navigateur ignore `'unsafe-inline'` dès qu'un nonce est
présent. Le développement renonce donc au nonce plutôt que d'ajouter les deux.

**Les scripts de flux échappent à `<Scripts>`.** React Router émet ses données
d'hydratation dans des balises `<script>` produites par le rendu en flux, pas par
le composant `<Scripts>`. Sans `entry.server` pour leur passer le nonce, la page
se chargeait sans jamais s'hydrater — et le service worker ne s'enregistrait pas.

**Le nonce ne voyage pas par la requête.** Premier réflexe : une table indexée
par `Request`, remplie dans le middleware, lue par le chargeur. Elle rendait
toujours vide — React Router ne transmet pas au chargeur l'instance que le
middleware a vue. Le nonce passe donc par le contexte asynchrone, qui traverse
tout l'arbre.

Une concession assumée : `blob:` dans `script-src`. L'AudioWorklet d'étirement
est compilé à la volée et chargé depuis un blob, et un module de worklet relève
de `script-src`, pas de `worker-src`. Seul du script déjà exécuté sur l'origine
peut fabriquer un blob : la porte n'est pas nouvelle.

## 8.4 — Journal, métriques, remontée d'erreurs

Une ligne JSON par événement en production, lisible à l'œil ailleurs. Le contexte
de requête — identifiant, chemin, utilisateur une fois la session résolue — passe
par un stockage asynchrone : sans cela, chaque fonction du chemin devrait porter
un identifiant dont elle n'a que faire. Chaque réponse porte son `x-request-id`,
donc chaque incident remonte à sa ligne.

`/metrics` expose une dizaine de séries au format Prometheus, protégées par un
jeton — elles décrivent le trafic et le nombre de comptes. Sans jeton configuré,
la route n'existe qu'en développement : mieux vaut une métrique manquante qu'une
fuite silencieuse.

Sentry est inerte sans DSN. Son instrumentation automatique n'est pas activée :
elle exige d'être chargée avant tout le reste, ce que le serveur de React Router
ne permet pas sans réécrire son point d'entrée.

## 8.5 — Trois manquements d'accessibilité, trouvés et corrigés

Axe passe sur quatre pages avec les règles WCAG 2.1 AA. L'analyse automatique ne
prouve pas qu'une interface est utilisable, mais elle attrape sans discussion ce
qui se mesure. Elle a trouvé :

- le champ fichier, masqué et déclenché par un bouton voisin, n'avait **aucun nom
  accessible** — un lecteur d'écran qui l'atteignait ne savait pas ce que c'était ;
- la durée affichée dans le transport, à 70 % d'opacité, tombait **sous le seuil
  de contraste AA** ;
- la liste de définitions de l'analyse contenait des **séparateurs** : un
  `role="separator"` entre deux paires en casse la lecture. Ils sont désormais
  dessinés en bordure.

Le reste — atteindre le dépôt de fichier à la tabulation, piloter le transport au
clavier — est vérifié à la main, parce qu'aucun analyseur ne le mesure.

## 8.6 — Sauvegardes : séparer ce qui se vérifie de ce qui ne se vérifie pas

`pg_dump` n'existe pas sur ce poste. La distribution PostgreSQL embarquée ne
livre que le serveur, et quatre tentatives d'installation en espace utilisateur
ont buté sur une cascade de bibliothèques partagées.

Plutôt que de déclarer la sauvegarde « écrite mais non vérifiée », elle est
**coupée en deux**. Le dump reste l'affaire de `pg_dump`, dans un script shell
avec `pipefail` — sans lui, un dump qui échoue laisserait passer un flux vide et
la sauvegarde serait déclarée réussie. Le dépôt et la rétention, eux — la partie
où l'on perd réellement des données si l'on se trompe — sont un script Node qui
lit l'entrée standard, et qui a été exécuté pour de bon contre le stockage objet.

La rétention ne supprime **jamais** la dernière sauvegarde. Sans cela, une panne
de sauvegarde prolongée se transformerait en perte de sauvegarde.

## 8.7 — La rétention S3 cherchait au mauvais endroit

Le nettoyage des objets orphelins parcourait `tracks/<id>/`. La convention réelle
est `users/<userId>/tracks/<id>/`. La première version ne trouvait donc que des
restes d'une phase antérieure — qu'elle a supprimés, à juste titre, mais pour la
mauvaise raison.

Corrigée, elle a été vérifiée dans les deux sens : **34 orphelins réels** trouvés
et supprimés, **1680 objets légitimes** laissés intacts.

## 8.8 — Chercher les valeurs, pas les noms

Un vérificateur parcourt le bundle client à la recherche des secrets. Première
version : chercher les **noms** de variables. Elle signalait aussitôt
`BETTER_AUTH_SECRET` — dans un accesseur d'environnement de better-auth qui cite
tous les noms possibles sans jamais porter de valeur.

Il cherche donc les **valeurs**, plus quelques témoins propres à nos modules
serveur — les messages de validation de `env.server.ts`, qui n'existent nulle part
ailleurs. Si l'un d'eux apparaît, c'est qu'un module serveur entier a suivi un
import jusqu'au navigateur. Validé par contrôle négatif : un secret planté dans un
fichier du build est détecté.

## 8.9 — Definition of Done

| Critère                                   | Résultat                                                      |
| ----------------------------------------- | ------------------------------------------------------------- |
| Limitation de débit                       | ✅ Redis, repli local, `Retry-After` — vérifié par test       |
| Quotas par plan                           | ✅ 5 morceaux/mois et 4 pistes en gratuit, affiché en continu |
| Erreurs typées de bout en bout            | ✅ `StemlabError` → code, statut, champs                      |
| Sentry                                    | ✅ câblé, inerte sans DSN — **DSN manquant, voir ci-dessous** |
| Journaux structurés                       | ✅ JSON + identifiant de requête propagé                      |
| `/metrics`                                | ✅ format Prometheus, protégé par jeton                       |
| Sauvegardes PostgreSQL quotidiennes       | ⚠️ dépôt et rétention vérifiés, `pg_dump` non exécutable ici  |
| Rétention S3                              | ✅ vérifiée dans les deux sens sur données réelles            |
| Accessibilité clavier et contraste AA     | ✅ axe sur 4 pages + parcours clavier, 3 défauts corrigés     |
| CSP                                       | ✅ nominative par nonce, vérifiée sur le build de production  |
| Validation Zod aux frontières             | ✅ corps **et** identifiants d'URL                            |
| Signature du webhook strictement vérifiée | ✅ sur le corps brut, avant désérialisation                   |
| Aucun secret dans le bundle client        | ✅ vérificateur en CI, validé par contrôle négatif            |

**Tests** : 80 E2E sur trois formats, dont onze consacrés au durcissement et à
l'accessibilité.

**Non vérifié**

- **Le dump PostgreSQL lui-même** : `pg_dump` n'est pas installable sur ce poste.
  La commande exacte est dans `scripts/backup-database.sh` ; à exécuter une fois
  sur une machine équipée avant la mise en production.
- **La remontée vers Sentry** : le DSN est un secret que je n'ai pas. Le câblage
  est en place et sans effet tant que `SENTRY_DSN` est vide.
- **Un échec intermittent du test hors-ligne**, sous charge machine : le
  navigateur refuse l'écriture pour place insuffisante alors que le quota annoncé
  est de 2 Gio. Le test porte désormais les chiffres du stockage dans son message
  d'échec, faute d'avoir pu reproduire la panne à la demande.

---

# Phase 9 — Paroles et traduction

## 9.1 — Pourquoi transcrire la voix isolée change tout

La transcription porte sur le stem `vocals`, pas sur le mixage. C'est le seul
avantage que cette application ait sur un transcripteur générique : une voix
débarrassée de la batterie, de la basse et des guitares se transcrit nettement
mieux, parce que le modèle n'a plus à démêler ce qui est parole de ce qui ne
l'est pas.

Cet ordre impose une contrainte sur le pipeline : la transcription vient **après**
la séparation et **avant** l'encodage. Le fichier confié à Whisper est un WAV
temporaire, pas l'Opus final — passer par un format avec perte n'apporterait rien
à un modèle qui rééchantillonne de toute façon en 16 kHz.

## 9.2 — `faster-whisper`, et pourquoi pas le paquet officiel

Même modèle, exécuté par CTranslate2 : plusieurs fois plus rapide sur processeur.
Cela compte ici, où aucun GPU n'est garanti, et cela comptera encore en
production, où le worker GPU s'éteint à vide.

Le modèle est configurable (`WHISPER_MODEL`) : `small` suffit aux tests et à un
poste sans GPU, `large-v3` sert en production. Le compromis n'a pas à être figé
dans le code.

## 9.3 — La traduction, ligne à ligne

OPUS-MT (Helsinki-NLP), un modèle par direction. Petits, rapides, sous licence
permissive — là où **NLLB-200 est non commercial**, ce qui tombe exactement sous
la contrainte déjà posée sur madmom.

La traduction se fait ligne à ligne, pas par bloc. L'alignement avec les
horodatages tient entièrement à la correspondance de position entre la liste des
lignes et celle des traductions ; une traduction globale redécoupée après coup ne
la garantirait pas. Le prix est un contexte plus court, donc quelques tournures
moins heureuses — c'est le bon échange quand l'affichage doit défiler.

Mesuré : à froid, 76 s (chargement du modèle compris) ; à chaud, **0,15 s**.

## 9.4 — Ce qui peut échouer, et ce que ça emporte

Trois garde-fous, tous pour la même raison : les pistes séparées sont l'essentiel
du service, et elles sont déjà là quand la transcription commence.

- Une transcription qui échoue est journalisée et **n'emporte pas** le reste.
- Un morceau instrumental ne rend **rien** plutôt qu'un texte inventé. Le
  détecteur d'activité vocale de Whisper écarte les longs passages instrumentaux,
  où le modèle a tendance à halluciner des paroles.
- Un retraitement qui ne rend plus de paroles **efface** celles de la version
  précédente, au lieu de les laisser derrière.

## 9.5 — Le tuple que TypeScript refusait

Écrire les paroles dans la même transaction que le reste a buté sur un détail :
la liste d'opérations de Prisma est typée comme un **tuple**, et un branchement
conditionnel — écrire ou effacer selon ce que le pipeline a rendu — en changeait
la forme. Rassembler les opérations dans un tableau nommé avant de le passer à
`$transaction` suffit.

## 9.6 — Hors-ligne, sans rien de plus à télécharger

Les paroles voyagent dans la page rendue par le serveur, que le service worker
met déjà en cache. Aucun appel séparé, aucun octet supplémentaire à prévoir dans
le budget de stockage : elles sont lisibles — et traduisibles — en mode avion.

Vérifié plutôt qu'affirmé : le test hors-ligne coupe le réseau, recharge, et
bascule la traduction.

## 9.7 — Definition of Done

| Critère                                      | Résultat                                             |
| -------------------------------------------- | ---------------------------------------------------- |
| Transcription sur la voix isolée             | ✅ après séparation, WAV temporaire, 16 kHz          |
| Horodatage au mot                            | ✅ ordre croissant vérifié                           |
| Détection de langue                          | ✅ `en` à 0,945 sur l'extrait de référence           |
| Traduction français ↔ anglais                | ✅ les deux sens, une traduction par ligne           |
| Défilement synchronisé et clic pour naviguer | ✅ même mécanisme que la grille d'accords            |
| Licences commerciales                        | ✅ Whisper MIT, OPUS-MT permissif — NLLB-200 écarté  |
| Un instrumental ne produit rien              | ✅ vérifié sur une sinusoïde                         |
| Disponible hors-ligne                        | ✅ voyage dans la page en cache, traduction comprise |
| Accessibilité AA du panneau                  | ✅ axe sur la page d'un morceau avec paroles         |

**Tests** : 11 Python, 5 de contrats, 5 E2E. Total du dépôt : 85 E2E, 222 Python.

**Mesures** (extrait de 11 s, processeur, modèle `small`) : pipeline complet
22,8 s, soit 2,1 × le temps réel, transcription et traduction comprises.

**Non vérifié**

- **La qualité sur du chant** : l'extrait de référence est de la parole. Le chant
  — tenues, vibrato, mélismes — se transcrit moins bien, et aucun extrait chanté
  libre de droits n'est disponible ici. À constater sur un vrai morceau.
- **Le modèle `large-v3`** : seul `small` a été exécuté. Le passage à `large-v3`
  ne change que la valeur de `WHISPER_MODEL`, mais ni le temps ni la qualité n'ont
  été mesurés.

---

# Intermède — Pad d'accords

Demandé en cours de phase 10, et construit avant de la reprendre.

## A.1 — Ce qu'on tient dans la main

Un pad d'accompagnement se joue d'une main pendant qu'on fait autre chose de
l'autre. Toute la conception découle de là : une tonalité, une grille, et plus
rien à décider en cours de route.

Les accords proposés sont ceux de la **tonalité choisie** — pas les douze
fondamentales chromatiques. Chercher un accord au milieu d'un chant est
exactement ce qu'il faut éviter, et une grille diatonique se lit sans y penser.

Huit pads : les sept degrés, plus un huitième. En majeur, c'est le **bVII**,
emprunté au mixolydien, omniprésent dans le répertoire de louange — où il
remplace souvent le vii°, que personne ne joue. En mineur, c'est le **V majeur**,
emprunté au mineur harmonique : le v naturel existe et reste proposé, mais c'est
le V qui résout. Les deux sont là ; le choix appartient au musicien.

## A.2 — Le bVII s'écrit Bb, même en do majeur

L'armure de do majeur n'a aucun bémol. La fonction du bVII, elle, est une
**septième abaissée** : elle occupe la lettre du septième degré, donc `Bb` et
jamais `A#`. L'orthographe suit la fonction, pas l'armure.

Le test l'a attrapé immédiatement, et c'est le genre de détail qu'un musicien
voit du premier coup d'œil. La correction tient en un champ facultatif sur le
degré, qui impose son orthographe quand la fonction l'emporte.

## A.3 — Huit timbres, aucun échantillon

Une nappe tenue se synthétise très bien. Chaque voix est une liste de partiels —
une onde, un rapport de fréquence, un gain, un désaccord — et c'est le
**désaccord** entre partiels, plus que la forme d'onde, qui donne son épaisseur
au son.

Le bénéfice n'est pas théorique : plusieurs dizaines de mégaoctets
d'échantillons en moins à télécharger, et un pad qui fonctionne hors connexion
sans avoir rien préparé.

La réverbération suit le même principe. Sa réponse impulsionnelle est un bruit
dont l'amplitude décroît exponentiellement — soit exactement la forme d'une queue
de réverbération dans une salle. Un enregistrement réel sonnerait plus juste,
pour quelques centaines de kilo-octets et un gain que personne n'entendrait sous
une nappe tenue.

## A.4 — Le fondu enchaîné est le sujet

Le principe d'une nappe est la continuité : passer d'un accord au suivant ne doit
jamais laisser de trou.

Chaque accord vit donc dans **son propre groupe d'oscillateurs**. Jouer un accord
démarre le suivant pendant que le précédent s'éteint — les deux se recouvrent,
comme deux mains sur un clavier. Rien n'est réutilisé d'un accord à l'autre :
reconfigurer des oscillateurs en cours de route produirait un glissando, pas un
fondu.

Deux détails qui s'entendent :

- la montée de l'enveloppe est **exponentielle**, parce que l'oreille perçoit le
  volume en décibels ; une rampe linéaire s'entend comme une arrivée brutale
  suivie d'un plateau ;
- le **filtre s'ouvre avec l'attaque**. Une nappe qui s'éclaircit en montant sonne
  vivante ; à timbre fixe, elle sonne comme un échantillon tenu.

## A.5 — Quatre couleurs, pas huit

Les pads sont colorés par **fonction tonale** — repos, départ, tension, couleur —
et non par degré. Quatre familles se lisent d'un coup d'œil ; huit teintes
demandent un effort de décodage que personne ne fournira en jouant.

Le pad actif « respire » : un battement de quatre secondes, l'amplitude d'un
souffle. Un accord tenu ne bouge pas à l'écran alors qu'il continue de sonner ;
ce mouvement le dit sans attirer l'œil. Il disparaît pour qui refuse les
animations — la couleur suffit alors.

## A.6 — Prouver que ça sonne

Un pad muet passerait tous les tests d'interface : les boutons changeraient
d'état, la grille suivrait la tonalité, et rien ne sortirait des enceintes.

Les tests de bout en bout instrumentent donc `OscillatorNode.prototype.start` et
comptent les démarrages réels. C'est la seule chose observable de l'extérieur qui
distingue un pad qui sonne d'un pad qui fait semblant.

## A.7 — Definition of Done

| Critère                                 | Résultat                                           |
| --------------------------------------- | -------------------------------------------------- |
| Choix de la tonalité, clic sur l'accord | ✅ douze fondamentales, majeur et mineur           |
| Grille diatonique de la tonalité        | ✅ sept degrés + un emprunt utile                  |
| Plusieurs timbres                       | ✅ huit, synthétisés, décrits en une phrase chacun |
| Accords tenus, fondu enchaîné           | ✅ recouvrement vérifié, aucun trou                |
| Enrichissements                         | ✅ triade, sus2, sus4, add9, septièmes             |
| Élégant sur mobile                      | ✅ vérifié à 390 px                                |
| **Du son est réellement produit**       | ✅ oscillateurs comptés au démarrage               |
| Accessibilité AA et clavier             | ✅ axe + parcours clavier, sur les deux formats    |
| Fonctionne hors connexion               | ✅ rien à télécharger : tout est synthétisé        |

**Tests** : 24 du moteur audio, 24 de théorie, 10 E2E sur deux formats.

**Non vérifié**

- **Le rendu à l'oreille** : l'environnement n'a pas de sortie audio. Les
  fréquences, les enveloppes et le recouvrement sont vérifiés par la mesure ; le
  goût des timbres, non. À écouter, et à ajuster — les voix sont des données,
  changer un partiel ne demande pas de toucher au moteur.

---

# Intermède — Trois sources pour le pad

## B.1 — Ce que vend réellement la référence

Le pad synthétisé ne convainquait pas. En cherchant la cause, j'ai regardé la
plateforme citée en référence : _Warmth_, _Dwell_, _Plume_, _OB Ambient Pads_,
_Ascent_… chaque produit est signé par un producteur, et la colonne de format
indique partout **« Playback »**. Il existe même des collections « Minor Key »
vendues séparément des majeures.

Ce ne sont donc pas des synthétiseurs : ce sont des **fichiers audio produits en
studio, un par tonalité**, lus en boucle et enchaînés par une application dédiée.
La valeur est dans l'enregistrement, pas dans l'algorithme.

Cela fixe une limite qu'il valait mieux énoncer que contourner : aucune synthèse
dans un navigateur n'égalera ce son, parce que le produit _est_ le contenu. Trois
réponses en découlent, et elles coexistent désormais.

## B.2 — Ce qui manquait vraiment au pad synthétisé

Avant de conclure quoi que ce soit, il fallait corriger la synthèse elle-même.
Les premières voix étaient des empilements additifs figés : ni stéréo, ni
mouvement, ni effets. Ce qui fait tenir une nappe, ce n'est pas le nombre de
partiels, c'est le **mouvement** — unisson désaccordé réparti dans l'espace,
dérive lente et indépendante de chaque oscillateur, filtre qui respire.

Et surtout, les **effets** : la réverbération remplit l'espace, l'écho remplit le
temps. L'écho est un envoi et non un insert, donc il continue de répéter pendant
que l'accord suivant monte — c'est précisément la continuité recherchée.

Le scintillement mérite une mention : une octave supérieure envoyée à la **seule**
réverbération, avec sa propre enveloppe retardée. Les vrais effets de _shimmer_
transposent la réinjection ; sans transposeur temps réel, une strate dédiée donne
le même résultat pour rien.

## B.3 — Une mesure qui a corrigé une erreur d'oreille

Ne pouvant rien entendre, j'ai rendu chaque timbre en fichier hors-ligne et
mesuré les crêtes. Résultat : jusqu'à **1,36** — cinq timbres sur huit écrêtaient.
L'unisson, l'ensemble et la saturation ajoutent chacun de l'énergie, et des gains
choisis à vue ne pouvaient pas le prévoir.

Les gains ont été recalculés d'après ces mesures. Puis une courbe de saturation
douce a été ajoutée en sortie : elle **borne mathématiquement** le signal, là où
un compresseur laisse passer ce qui arrive plus vite que son temps d'attaque.

## B.4 — La source échantillonnée, et une licence écartée

`js-synthesizer` embarque FluidSynth. Son propre README l'indique :
**libfluidsynth est en LGPL v2.1**, licence différente de celle du wrapper. C'est
exactement la situation qui avait fait écarter SoundTouch en phase 6 — l'exigence
de relien n'a pas de sens pour un module empaqueté dans un bundle navigateur.

`spessasynth` (Apache-2.0) fait le même travail sans ce problème. La banque
retenue est **FluidR3Mono_GM.sf3**, sous licence MIT, distribuée par le dépôt de
MuseScore.

Elle n'est ni versionnée ni précachée : vingt-quatre mégaoctets dans l'historique
Git pénaliseraient chaque clone, et dans le précache du service worker, chaque
installation. Elle se récupère par `pnpm soundfont`, et le navigateur ne la
télécharge que si l'on demande une voix échantillonnée.

Un détail qui s'entend : les notes communes à deux accords successifs ne sont
**pas** relancées. Réattaquer une note déjà tenue s'entend comme un accroc, alors
que l'enchaînement doit être continu. C'est la différence avec la synthèse, où
chaque accord a ses propres oscillateurs.

## B.5 — Vos propres nappes

La troisième source suit le modèle de la référence : un fichier par tonalité, tenu
en boucle, avec un fondu enchaîné au changement de tonalité.

**Aucun effet n'est ajouté.** Ces fichiers sortent d'un studio, réverbération
comprise. Les réglages qui n'ont pas de prise — timbre, douceur — sont masqués ou
désactivés, plutôt que laissés actifs et sans effet.

**La tonalité est lue dans le nom du fichier.** Les bibliothèques la mettent
presque toujours, et la deviner évite vingt-quatre réglages manuels. Première
tentative : chercher une note n'importe où dans le nom. Elle lisait `A` dans
« Ambient », `D` dans « Dwell » et `G` dans « Grandiose » — les noms de fichiers
en sont pleins. La version retenue découpe en **jetons entiers** et ne reconnaît
qu'un jeton qui _est_ une tonalité : `C`, `F#`, `Bbm`, `Amaj`, ou une note suivie
de `major`/`minor`.

**Une nappe couvre une tonalité, pas un accord.** C'est l'écart de fond avec les
deux autres sources, et l'interface le dit : quel que soit le pad touché, c'est la
nappe de la tonalité qui sonne.

## B.6 — Definition of Done

| Critère                                  | Résultat                                                     |
| ---------------------------------------- | ------------------------------------------------------------ |
| Synthèse : mouvement et effets           | ✅ unisson stéréo, dérive, filtre animé, écho, scintillement |
| Aucun écrêtage                           | ✅ gains mesurés par rendu, sortie bornée par saturation     |
| Source échantillonnée                    | ✅ SoundFont, licences vérifiées à la source                 |
| Banque hors du dépôt et hors du précache | ✅ `pnpm soundfont`, cache local après premier usage         |
| Banque personnelle                       | ✅ `.sf2`, `.sf3`, `.dls`                                    |
| Nappes personnelles, une par tonalité    | ✅ tonalité lue dans le nom, fondu réglable                  |
| Les fichiers ne quittent pas l'appareil  | ✅ stockage local dédié                                      |
| Preuve que chaque source sonne           | ✅ oscillateurs comptés, fichiers comptés                    |
| Accessibilité AA sur les trois sources   | ✅                                                           |

**Tests** : 178 du moteur audio, 98 de théorie, 21 de bout en bout.

**Non vérifié**

- **Le rendu à l'oreille**, toujours : l'environnement n'a pas de sortie audio.
  Les fréquences, enveloppes, recouvrements et niveaux sont mesurés ; le goût des
  timbres, non. Des aperçus audio ont été rendus pour que ce jugement puisse être
  porté.
- **Le bouclage des nappes importées** : les fichiers du commerce sont conçus pour
  boucler proprement, et c'est ce qui est supposé. Un fichier qui ne boucle pas
  s'entendra ; aucun fondu au point de bouclage n'est appliqué.

---

# Phase 10 — Mise en production

## 10.1 — Ce qui se prépare sans pouvoir s'exécuter

Cette phase a une particularité : la plus grande partie de son objet — déployer —
ne peut pas être exécutée ici. Ni compte Fly.io, ni compte Modal, ni domaine, ni
base de production. Le travail a donc consisté à séparer ce qui se vérifie de ce
qui ne se vérifie pas, et à réduire le second au minimum.

Se vérifient, et ont été exécutés : le contrôle de configuration, le contrôle de
réversibilité des migrations, la politique CORS du stockage, le dépôt et la
rétention des sauvegardes, le nettoyage des objets orphelins, la page légale.

Ne se vérifient pas : `flyctl deploy`, `modal deploy`, l'obtention d'un certificat.
Les commandes sont celles de la documentation de chaque outil, et c'est dit.

## 10.2 — Une adresse de lecture ne peut plus être publique

Le défaut le plus grave de cette phase n'a pas été introduit par elle : il
dormait depuis la phase 4.

`presignDownload` renvoyait une **URL publique et permanente** dès que
`S3_PUBLIC_URL` était renseignée — sans signature, sans expiration. La variable
était vide partout, donc rien ne l'avait jamais révélé. Mais elle s'appelle
« URL publique », la documentation de déploiement allait pousser à la renseigner
pour brancher un CDN, et la page légale que je venais d'écrire affirme :
« Les adresses de téléchargement sont signées et expirent au bout de quelques
minutes. »

Le code contredisait la promesse au moment précis où on l'aurait configuré.

Le chemin est supprimé. Mettre un CDN devant des fichiers privés demanderait de
les signer **au niveau du CDN** : une signature S3 porte sur l'hôte, et le
réécrire l'invalide. Ce n'est pas implémenté, donc le seau ne doit jamais être
rendu public. Le CDN garde sa place devant l'application, dont les fichiers
statiques sont publics par nature.

## 10.3 — Le CORS, ou l'échec sans trace

L'audio ne transite jamais par l'application : le navigateur dépose et récupère
directement sur le stockage. Ce sont donc des requêtes inter-origines — et sans
politique CORS, le navigateur les refuse **avant de les émettre**. L'envoi échoue
sans qu'aucune ligne n'apparaisse côté serveur.

MinIO et SeaweedFS sont permissifs par défaut, ce qui masque entièrement le
problème en développement. R2 ne l'est pas. `pnpm s3:cors` pose la politique, et
elle a été vérifiée ici : appliquée au stockage local, relue, puis le parcours
complet — inscription, envoi, traitement, lecture — rejoué avec elle en place.

Au passage, cette vérification a failli produire un faux diagnostic. Le parcours
échouait, et la politique CORS venait d'être posée : le rapprochement était
tentant. Le dépôt avait en réalité réussi, le job était en file, et c'était le
worker qui ne tournait pas. Vérifier avant de conclure aura épargné une
« correction » d'un défaut inexistant.

## 10.4 — Deux gardes avant de déployer

`pnpm preflight` refuse une configuration incomplète ou restée à ses valeurs
d'exemple, et connaît les particularités de R2 : `S3_REGION` doit valoir `auto`,
`S3_FORCE_PATH_STYLE` doit être faux. Ces deux-là produisent une erreur de
signature dont le message ne dit rien de la cause.

`node scripts/check-migrations.mjs` signale ce qui rendrait le retour arrière
destructif. Il n'échoue pas : une migration destructive est parfois le bon choix.
Elle doit seulement être vue avant d'être fusionnée.

Les deux ont été vérifiés dans les deux sens, contrôle négatif compris.

## 10.5 — Definition of Done

| Critère                                   | Résultat                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Fly.io, deux régions, sondes de santé     | ⚠️ configuré, **non déployé** — aucun compte ici                                    |
| Migrations jouées à la release            | ⚠️ `release_command` déclaré, non exécuté                                           |
| Worker GPU serverless, scale-to-zero      | ⚠️ `min_containers: 0`, **non déployé**                                             |
| R2 + CDN                                  | ✅ configuration vérifiée ; CDN **volontairement absent** de l'audio                |
| CORS du stockage                          | ✅ appliqué et vérifié par le parcours complet                                      |
| Domaine et TLS                            | ⚠️ documenté, **non obtenu**                                                        |
| Déploiement par GitHub Actions sur `main` | ⚠️ workflow écrit, non exécuté                                                      |
| Procédure de retour arrière éprouvée      | ⚠️ écrite ; les scripts qu'elle appelle sont exécutés, pas les commandes des outils |
| Page légale                               | ✅ trois engagements, testés et accessibles AA                                      |

**Tests** : 135 E2E sur trois formats.

**Non vérifié — et ce qui manque pour l'être**

- **Le déploiement lui-même** : il faut un compte Fly.io, un compte Modal, un
  domaine. Ce sont des accès que je n'ai pas.
- **`pg_dump`** : non installable ici, quatre approches distinctes. Le dépôt et la
  rétention, eux, sont exécutés pour de bon.
- **La remontée Sentry** : le DSN est un secret que je n'ai pas.
- **L'installation sur Chrome Android et Safari iOS** : aucun appareil ici.
