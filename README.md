# STEMLAB

Séparation de pistes audio par IA et analyse musicale. Vous déposez un morceau,
STEMLAB en extrait les pistes (voix, batterie, basse, guitare, piano, autres),
détecte la tonalité, le tempo, la grille de mesures et la suite d'accords, puis vous
rend la main dans un lecteur multipiste synchronisé — utilisable hors-ligne.

> Usage strictement personnel. Les fichiers restent privés à leur propriétaire :
> il n'existe ni partage public, ni catalogue, ni bibliothèque commune.

---

## Architecture

```mermaid
flowchart LR
  subgraph client["Navigateur (PWA)"]
    UI["React Router v7<br/>Tailwind v4"]
    ENGINE["@stemlab/audio-engine<br/>Web Audio + AudioWorklet"]
    OPFS[("OPFS<br/>stems hors-ligne")]
    UI --- ENGINE
    ENGINE --- OPFS
  end

  subgraph web["apps/web — BFF (Node)"]
    LOADERS["loaders / actions"]
    AUTH["better-auth"]
    PRISMA["Prisma"]
  end

  subgraph ml["apps/ml — service ML (Python)"]
    API["FastAPI<br/>POST /jobs"]
    WORKER["worker ARQ<br/>Demucs + Essentia"]
  end

  PG[("PostgreSQL")]
  REDIS[("Redis<br/>file de jobs")]
  S3[("S3<br/>MinIO / R2")]

  UI -->|"HTTP"| LOADERS
  LOADERS --- AUTH
  LOADERS --- PRISMA
  PRISMA --> PG

  UI -.->|"PUT présigné"| S3
  ENGINE -.->|"GET présigné"| S3

  LOADERS -->|"POST /jobs<br/>signé HMAC"| API
  API -->|"enqueue"| REDIS
  REDIS --> WORKER
  WORKER -->|"lit l'original<br/>écrit les stems"| S3
  WORKER -->|"webhook signé HMAC"| LOADERS
```

Trois principes structurent le découpage :

1. **Le worker ne touche jamais la base.** Il rend son résultat au BFF par un webhook
   signé HMAC ; le BFF est le seul écrivain de PostgreSQL.
2. **L'audio ne transite jamais par l'application.** Le navigateur envoie et récupère
   les fichiers directement sur S3 via des URLs présignées.
3. **Les frontières sont typées à l'exécution.** Tout ce qui traverse HTTP est validé
   par un schéma Zod de `packages/contracts`, partagé par les deux côtés.

### Structure du dépôt

```
.
├─ apps/
│  ├─ web/                 React Router v7 + PWA — BFF, auth, base de données
│  └─ ml/                  FastAPI + worker ARQ — Demucs, Essentia
├─ packages/
│  ├─ contracts/           schémas Zod et types partagés (source de vérité des API)
│  ├─ database/            schéma Prisma, migrations, client généré
│  ├─ ui/                  composants shadcn/ui et thème partagé
│  └─ audio-engine/        moteur Web Audio, sans dépendance à un framework
├─ infra/
│  ├─ docker-compose.yml   stack de développement complète
│  ├─ fly/                 déploiement web + API
│  └─ modal/               worker GPU serverless
├─ scripts/                outillage de développement
├─ DECISIONS.md            décisions prises en autonomie, avec justification
└─ PROGRESS.md             avancement phase par phase
```

---

## Démarrage local

**Prérequis** : Node ≥ 22.12, [pnpm](https://pnpm.io) 11, [uv](https://docs.astral.sh/uv/),
`ffmpeg`. Docker est optionnel (voir ci-dessous).

```bash
# 1. dépendances
pnpm install                 # JavaScript / TypeScript
pnpm --filter @stemlab/ml exec uv sync   # Python

# 2. configuration
cp .env.example .env         # les valeurs par défaut suffisent en local

# 3. services (Postgres, Redis, S3)
docker compose -f infra/docker-compose.yml up -d
#   … ou, sans Docker :
pnpm services

# 4. lancer l'application
pnpm dev
```

- Application : <http://localhost:3000>
- API ML : <http://localhost:8000> (documentation interactive sur `/docs`)
- Sondes : `/health` sur les deux

### Sans Docker

`pnpm services` démarre Postgres, Redis et un stockage S3-compatible **en espace
utilisateur**, sans `root`, sur les mêmes ports que la stack Docker. Les binaires
sont téléchargés une seule fois dans `.devservices/`.

```bash
pnpm services            # équivaut à `pnpm services start`
pnpm services status
pnpm services stop
pnpm services reset      # supprime les données, garde les binaires
pnpm services logs postgres
```

| Service    | Port  | URL de connexion                                       |
| ---------- | ----- | ------------------------------------------------------ |
| PostgreSQL | 55432 | `postgresql://stemlab:stemlab@localhost:55432/stemlab` |
| Redis      | 56379 | `redis://localhost:56379/0`                            |
| S3         | 59000 | `http://localhost:59000` — bucket `stemlab`            |

---

## Service de jobs

Le BFF dépose un job sur le service ML, qui le met en file et rend son résultat par
un **webhook signé**. Le worker ne touche jamais la base de données.

| Route               | Rôle                                         |
| ------------------- | -------------------------------------------- |
| `POST /jobs`        | dépose un job — signature HMAC obligatoire   |
| `GET /jobs/{id}`    | progression, étape en cours, erreur          |
| `GET /dead-letters` | jobs définitivement échoués, pour inspection |
| `GET /health`       | liveness — répond sans charger torch         |
| `GET /ready`        | readiness — vérifie Redis                    |

**Signature.** La chaîne signée est `${timestamp}.${corps_brut}`, en HMAC-SHA256
hexadécimal, transportée dans `x-stemlab-signature` avec `x-stemlab-timestamp`. La
fenêtre de tolérance est de 300 s. Les deux implémentations — TypeScript et Python —
sont vérifiées contre des vecteurs partagés (`fixtures/signature-vectors.json`).

**Idempotence.** Un fichier déjà traité avec le même modèle ne repasse pas dans le
pipeline : le webhook de succès est simplement rejoué, à l'identique. La clé est
`(checksum, modèle)` — le même fichier séparé en six stems n'est pas le même résultat
qu'en quatre.

**Reprise.** Trois essais au total, avec recul exponentiel (5 s puis 20 s). Un
redémarrage du worker en cours de traitement remet le job en file : rien n'est perdu.
Au-delà des essais, le job part en file de rebut plutôt que de disparaître.

### Essayer en local

```bash
# 1. les services, puis l'API et le worker
pnpm services
pnpm --filter @stemlab/ml dev        # API sur :8000
pnpm --filter @stemlab/ml worker     # worker ARQ

# 2. un receveur de webhook qui vérifie la signature
uv run --project apps/ml python scripts/webhook-receiver.py

# 3. déposer un job signé
SECRET=dev-only-change-me-hmac-secret
BODY='{"trackId":"...","sourceKey":"tracks/x/original.mp3","checksum":"<sha256>",
       "model":"htdemucs","outputPrefix":"tracks/x/stems",
       "callbackUrl":"http://127.0.0.1:3999/api/internal/jobs/callback"}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.*= //')
curl -X POST http://127.0.0.1:8000/jobs \
  -H "content-type: application/json" \
  -H "x-stemlab-signature: $SIG" -H "x-stemlab-timestamp: $TS" \
  --data-binary "$BODY"
```

---

## Commandes

| Commande          | Effet                                                |
| ----------------- | ---------------------------------------------------- |
| `pnpm dev`        | web (3000) + service ML (8000) en parallèle          |
| `pnpm build`      | bundles de production                                |
| `pnpm typecheck`  | `tsc` sur les paquets TS, `mypy --strict` sur Python |
| `pnpm lint`       | ESLint, puis `ruff check` et `ruff format --check`   |
| `pnpm test`       | Vitest et pytest                                     |
| `pnpm test:e2e`   | Playwright                                           |
| `pnpm format`     | Prettier en écriture                                 |
| `pnpm services`   | services locaux sans Docker                          |
| `pnpm db:migrate` | migration Prisma en développement                    |
| `pnpm db:studio`  | explorateur de base Prisma                           |

---

## Parcours applicatif

```
/signup, /login   →   /library   →   /tracks/:id
                        │  dépôt direct sur S3 (URL présignée)
                        │  suivi en direct (SSE)
                        └─ lecteur multipiste
```

Les routes sont groupées par nature dans `apps/web/app/routes/` : `auth/`,
`dashboard/`, `api/`. Les noms de pages et les URL sont en anglais ; les textes
affichés sont en français.

**L'audio ne transite jamais par l'application.** Le navigateur obtient une URL
présignée, dépose le fichier directement sur le stockage objet, puis confirme. Le
serveur ne fait que signer et orchestrer.

> **Piège connu.** Le SDK AWS v3 joint par défaut un checksum CRC32 à chaque envoi.
> Sur une URL présignée, le navigateur ne peut pas le produire et le dépôt échoue en
> `BadDigest`. Le client S3 est donc configuré avec
> `requestChecksumCalculation: 'WHEN_REQUIRED'`.

---

## Déploiement

_Détaillé en phase 9._ La cible : web et API sur **Fly.io** (deux régions, migrations
jouées à la release), worker GPU **serverless sur Modal** (L4, _scale-to-zero_ : aucune
instance GPU allumée à vide), stockage **Cloudflare R2** derrière un CDN.

---

## Dépannage

**`pnpm services` échoue au démarrage de Postgres.**
Les journaux sont dans `.devservices/logs/`. Un port déjà occupé est la cause la plus
fréquente : `pnpm services status` indique ce qui écoute.

**Le port 59000 reste occupé après `pnpm services stop`.**
La passerelle S3 met quelques secondes à rendre ses ports ; le script attend la
fermeture effective, mais un `start` lancé pendant cette fenêtre peut croire le
service déjà en place. Relancer `pnpm services status` puis `start`.

**`Cannot find package 'pg'` en lançant un script de `scripts/`.**
Ces scripts s'appuient sur les dépendances de développement de la racine ; il faut
`pnpm install` à la racine, pas seulement dans un sous-paquet.

**`uv sync` ne résout pas les dépendances.**
`arq` contraint `redis<6` : ne pas ajouter `redis` en dépendance directe avec une
borne supérieure plus élevée.

**Le worker refuse de démarrer : `'staticmethod' object has no attribute 'host'`.**
`WorkerSettings.redis_settings` doit être une _instance_ de `RedisSettings`, pas une
méthode. Elle est construite au chargement du module.

**Le worker plante sur `ModuleNotFoundError: torch`.**
`uv run` resynchronise l'environnement à chaque appel. Les dépendances lourdes sont
pour cette raison un _groupe_ uv listé dans `tool.uv.default-groups`, pas un extra :
un extra non demandé sur la ligne de commande serait désinstallé.

**Un dépôt de fichier échoue en `BadDigest` ou `InvalidDigest`.**
Le checksum CRC32 du SDK AWS v3 — voir la note dans « Parcours applicatif ».

**Les modèles Demucs se re-téléchargent à chaque exécution.**
Ils sont mis en cache dans `~/.cache/torch`. Sous Docker, ce chemin est monté sur le
volume `demucs-models`.
