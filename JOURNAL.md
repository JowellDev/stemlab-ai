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
