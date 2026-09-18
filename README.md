# STEMLAB

Séparation de pistes audio par IA et analyse musicale. Vous déposez un morceau,
STEMLAB en extrait les pistes (voix, batterie, basse, guitare, piano, autres),
détecte la tonalité, le tempo, la grille de mesures et la suite d'accords,
transcrit les paroles et les traduit, puis vous rend la main dans un lecteur
multipiste synchronisé — utilisable hors-ligne.

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
│  ├─ music/               théorie musicale : transposition, grille, recherche
│  ├─ ui/                  composants shadcn/ui et thème partagé
│  ├─ audio-engine/        moteur Web Audio + pad d'accords, sans framework
│  └─ offline/             stockage OPFS, budget, file d'envoi différée
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
| `pnpm soundfont`  | récupère la banque d'échantillons du pad (24 Mo)     |
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

**Tempo et hauteur sont indépendants.** Toutes les pistes sont chargées dans un
**unique** nœud d'étirement temporel (Signalsmith Stretch, WASM dans un
AudioWorklet), sous forme de paires de canaux. Une seule analyse pilote l'ensemble :
la dérive entre pistes n'est pas seulement improbable, elle est structurellement
impossible. Mesuré : 0 échantillon d'écart après cinq minutes à 75 % de tempo et
−3 demi-tons.

Quand l'AudioWorklet ne peut pas être chargé, la lecture bascule sur des sources
classiques — le tempo déplace alors aussi la hauteur, et l'interface le signale.

> **Piège connu.** Le SDK AWS v3 joint par défaut un checksum CRC32 à chaque envoi.
> Sur une URL présignée, le navigateur ne peut pas le produire et le dépôt échoue en
> `BadDigest`. Le client S3 est donc configuré avec
> `requestChecksumCalculation: 'WHEN_REQUIRED'`.

---

## Pad d'accords

Une page autonome (`/pad`) pour accompagner un temps de chant ou une répétition :
on choisit une tonalité, on touche un accord, il se tient jusqu'au suivant.

```
tonalite ──► grille diatonique ──► [ C ][ Dm ][ Em ][ F ]
                                    [ G ][ Am ][Bdim][ Bb ]
                                      │
                                      └─► nappe tenue, fondu enchaine
```

**La grille est diatonique, pas chromatique.** Un pad se joue sans regarder :
chercher un accord parmi douze est exactement ce qu'il faut éviter. Huit pads —
les sept degrés, plus un emprunt utile : le `bVII` en majeur, le `V` majeur en
mineur, tous deux omniprésents dans le répertoire de louange.

**Trois sources, assumées pour ce qu'elles sont.**

| Source           | Ce qu'elle apporte                    | Ce qu'elle coûte                          |
| ---------------- | ------------------------------------- | ----------------------------------------- |
| **Synthèse**     | rien à télécharger, marche hors ligne | ne sonnera jamais comme un enregistrement |
| **Échantillons** | le grain d'instruments réels          | 24 Mo au premier usage ; nappes GM datées |
| **Mes nappes**   | exactement le son voulu               | il faut posséder les fichiers             |

**Synthèse.** Huit timbres, aucun échantillon : unisson stéréo désaccordé, dérive
lente et indépendante de chaque oscillateur, filtre qui respire, écho stéréo
alterné et scintillement envoyé à la seule réverbération. Ce qui fait tenir une
nappe, c'est le mouvement — pas le nombre de partiels.

Chaque accord vit dans son propre groupe d'oscillateurs : le suivant monte pendant
que le précédent descend. Réutiliser les oscillateurs produirait un glissando, pas
un fondu.

**Échantillons.** Un synthétiseur SoundFont (`spessasynth`, Apache-2.0) et la
banque `FluidR3Mono_GM.sf3` (MIT). Récupérée par `pnpm soundfont`, jamais
précachée, téléchargée par le navigateur au premier usage puis conservée
localement. On peut charger sa propre banque `.sf2`.

> **Licence.** FluidSynth a été écarté : son wrapper npm est en BSD, mais
> **libfluidsynth est en LGPL v2.1** — la même raison qui avait fait écarter
> SoundTouch en phase 6.

**Mes nappes.** Le modèle des bibliothèques du commerce : un fichier par tonalité,
tenu en boucle, avec un fondu enchaîné au changement de tonalité. La tonalité est
lue dans le nom du fichier, et reste modifiable. **Aucun effet n'est ajouté** —
ces enregistrements sortent d'un studio, réverbération comprise. Les fichiers
restent sur l'appareil et ne passent jamais par le serveur.

> Une nappe enregistrée couvre **une tonalité, pas un accord** : quel que soit le
> pad touché, c'est la nappe de la tonalité qui sonne.

Les pads sont colorés par fonction tonale — repos, départ, tension, couleur —
et non par degré : quatre familles se lisent d'un coup d'œil, huit teintes
demandent un décodage que personne ne fera en jouant.

> **Détail qui compte.** Le `bVII` s'écrit `Bb` en do majeur, jamais `A#`, bien
> que l'armure de do n'ait aucun bémol : l'orthographe suit la fonction — une
> septième abaissée — et non l'armure.

---

## Paroles et traduction

La transcription porte sur le stem `vocals` **déjà isolé**, pas sur le mixage :
c'est le seul avantage structurel de cette application sur un transcripteur
générique, et il ne coûte rien puisque la séparation a lieu de toute façon.

```
mixage ──► séparation ──► vocals.wav ──► Whisper ──► lignes horodatées au mot
                                                          │
                                                          └─► OPUS-MT ──► traduction
```

| Étape         | Modèle                               | Licence    |
| ------------- | ------------------------------------ | ---------- |
| Transcription | `faster-whisper` (CTranslate2)       | MIT        |
| Traduction    | `Helsinki-NLP/opus-mt-{en-fr,fr-en}` | permissive |

`faster-whisper` plutôt que le paquet officiel : même modèle, plusieurs fois plus
rapide sur processeur. **NLLB-200 est écarté** — ses poids sont non commerciaux,
la même contrainte qui avait fait écarter madmom.

**La traduction est faite ligne à ligne.** L'alignement avec les horodatages tient
entièrement à la correspondance de position entre lignes et traductions ; traduire
le texte entier puis le redécouper ne le garantirait pas.

**Rien de tout cela ne peut faire échouer une séparation.** Une transcription qui
échoue est journalisée et avalée : les pistes sont l'essentiel du service, et elles
sont déjà produites. Un morceau instrumental rend `null` plutôt qu'un texte
inventé — un résultat vide serait indistinguable d'un échec.

**Hors-ligne**, les paroles voyagent dans la page mise en cache : aucun appel
séparé, aucun octet supplémentaire dans le budget de stockage.

| Variable              | Défaut  | Effet                                     |
| --------------------- | ------- | ----------------------------------------- |
| `TRANSCRIBE_LYRICS`   | `true`  | désactive l'étape entière                 |
| `WHISPER_MODEL`       | `small` | `large-v3` en production                  |
| `LYRICS_TRANSLATE_TO` | `fr,en` | langues cibles, séparées par des virgules |

---

## Sécurité et exploitation

**Quotas.** Le plan gratuit permet cinq morceaux par mois et quatre pistes ; le
plan payé lève la limite et ouvre la séparation en six pistes. Le compteur porte
sur les morceaux **créés** dans le mois : supprimer un morceau ne rend pas son
crédit, puisque c'est le calcul qui coûte, pas le stockage. La consommation est
affichée en permanence, plutôt que révélée au moment du refus.

**Limitation de débit.** Fenêtre fixe dans Redis, partagée entre instances, avec
repli local quand Redis ne répond pas. L'identité limitée est l'utilisateur quand
il est connu, l'adresse sinon. Les refus portent un `Retry-After`.

| Compartiment | Par défaut   | Portée      |
| ------------ | ------------ | ----------- |
| `auth`       | 10 / minute  | adresse     |
| `upload`     | 20 / minute  | utilisateur |
| `api`        | 240 / minute | utilisateur |

**Politique de contenu.** Nominative par `nonce`, sans `'unsafe-inline'` sur les
scripts. Les en-têtes de sécurité sont posés par un middleware racine, donc aussi
sur les requêtes de données et les routes de ressources.

> **Piège connu.** Un navigateur ignore `'unsafe-inline'` dès qu'un `nonce` est
> présent, et les scripts de flux de React Router n'émanent pas de `<Scripts>` :
> ils exigent un `entry.server`. Voir `DECISIONS.md`.

**Observabilité.** Une ligne JSON par requête en production, avec un identifiant
propagé et renvoyé dans `x-request-id`. `/metrics` expose une dizaine de séries au
format Prometheus, protégées par `METRICS_TOKEN` — sans jeton, la route n'existe
qu'en développement. Sentry est câblé et inerte tant que `SENTRY_DSN` est vide.

**Exploitation.**

```bash
# sauvegarde : le dump traverse le tube jusqu'au stockage, jamais le disque
DATABASE_URL=… ./scripts/backup-database.sh
node scripts/backup-store.mjs --list
node scripts/backup-store.mjs --prune

# objets sans morceau correspondant — sans effet tant que --apply est absent
node scripts/prune-orphans.mjs
node scripts/prune-orphans.mjs --apply

# aucun secret n'a suivi un import jusqu'au navigateur
pnpm build && pnpm check:bundle
```

La rétention ne supprime jamais la dernière sauvegarde : une panne de sauvegarde
prolongée deviendrait sinon une perte de sauvegarde.

---

## Hors-ligne et installation

L'application s'installe depuis le navigateur et fonctionne sans réseau pour les
morceaux déjà téléchargés.

```
/tracks/:id  ──[ Rendre disponible hors connexion ]──►  OPFS
                                                         ├─ vocals.opus
                                                         ├─ drums.opus
                                                         └─ …
```

**Les octets sont sur l'appareil, pas seulement la page.** Les stems sont conservés
dans l'_Origin Private File System_, et le lecteur les lit par des URL d'un schéma
interne — `stemlab-offline:<trackId>/<stem>` — résolues par un `fetch` dédié. Le
moteur audio ignore d'où viennent les octets.

**Budget et éviction.** 2 Gio, en gardant 50 Mio de marge sur le quota du navigateur.
Quand la place manque, les morceaux les moins récemment lus partent d'abord ; celui
qu'on télécharge est protégé.

**Envoi différé.** Un fichier déposé sans réseau est conservé localement et reparti
tout seul au retour de la connexion. Un refus du serveur (format, taille, quota) le
retire de la file ; une panne réseau l'y laisse.

**Routage du service worker.** Une navigation tente le réseau, retombe sur la page en
cache, puis sur `public/offline.html` — une page **statique**, sans script. Servir le
rendu serveur d'une route sous une autre URL casserait l'hydratation.

> **Piège connu.** `navigateFallback` de Workbox enregistre sa route avant celles de
> `runtimeCaching` et ne précache pas la page qu'il désigne. Les deux comportements
> sont contournés explicitement dans `vite.config.ts` ; voir `DECISIONS.md`.

**Vérification.** `e2e/offline.spec.ts` s'exécute contre un **build de production**
(format Playwright `pwa`, port 3200) : en développement, les modules servis par Vite
ne sont pas précachés et la page ne s'hydraterait jamais hors réseau.

---

## Déploiement

_Détaillé en phase 10._ La cible : web et API sur **Fly.io** (deux régions, migrations
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

**Le nœud d'étirement ne produit aucun son.**
Chrome n'exécute pas le `process()` d'un `AudioWorkletNode` déclaré **sans entrée**,
même lorsque ce nœud est une source. Une entrée est donc déclarée et laissée non
connectée.

**Le worker plante sur `ModuleNotFoundError: torch`.**
`uv run` resynchronise l'environnement à chaque appel. Les dépendances lourdes sont
pour cette raison un _groupe_ uv listé dans `tool.uv.default-groups`, pas un extra :
un extra non demandé sur la ligne de commande serait désinstallé.

**Un dépôt de fichier échoue en `BadDigest` ou `InvalidDigest`.**
Le checksum CRC32 du SDK AWS v3 — voir la note dans « Parcours applicatif ».

**Les modèles Demucs se re-téléchargent à chaque exécution.**
Ils sont mis en cache dans `~/.cache/torch`. Sous Docker, ce chemin est monté sur le
volume `demucs-models`.
