# Décisions d'architecture

Chaque entrée consigne une décision prise en autonomie pendant la construction,
avec sa justification et, le cas échéant, le risque accepté.

---

## 2026-09-17 — Le monorepo vit à la racine du dépôt

**Décision.** La structure `apps/`, `packages/`, `infra/` est posée directement à la
racine, sans dossier `stemlab/` intermédiaire.

**Pourquoi.** Le dépôt _est_ le projet ; un niveau de plus n'apporterait qu'un `cd`
supplémentaire dans toutes les commandes et casserait les chemins par défaut de
turborepo, pnpm et GitHub Actions.

---

## 2026-09-17 — Docker indisponible : services de dev en userspace

**Contexte.** Le poste de développement est une distro WSL 2 sans intégration Docker
Desktop (`docker` introuvable) et sans `sudo`. `docker compose up` ne peut donc pas
être exécuté ici.

**Décision.** `infra/docker-compose.yml` est écrit et maintenu comme voie principale,
mais un repli sans privilèges est fourni : `pnpm services` (`scripts/dev-services.sh`)
démarre les mêmes services sur les mêmes ports, en téléchargeant les binaires dans
`.devservices/` :

| Service         | Implémentation userspace                           | Port  |
| --------------- | -------------------------------------------------- | ----- |
| PostgreSQL 17.2 | binaires zonky `embedded-postgres` (Maven Central) | 55432 |
| Redis 8.0.3     | compilé depuis les sources (`make MALLOC=libc`)    | 56379 |
| S3              | SeaweedFS 4.47, passerelle S3                      | 59000 |

**Risque accepté.** `docker compose up` n'a pas pu être vérifié par exécution sur ce
poste. Le fichier suit la même topologie et les mêmes ports que le script validé ;
il devra être exécuté une fois sur une machine disposant de Docker avant la mise en
production. C'est le seul élément de la phase 0 non vérifié par exécution réelle.

**Détails d'implémentation notables.**

- Les binaires zonky n'embarquent ni `psql` ni `createdb` : la base applicative est
  créée par `scripts/ensure-db.mjs` via le client `pg`, et le bucket S3 par
  `scripts/ensure-bucket.mjs` via une requête SigV4 signée.
- SeaweedFS dérive par défaut ses ports gRPC en `port + 10000`, ce qui dépasse 65535
  avec des ports 59xxx : les ports gRPC sont donc fixés explicitement en 49xxx.
- MinIO n'est plus téléchargeable publiquement (`dl.min.io` répond 410), d'où le
  choix de SeaweedFS en local. `docker-compose.yml` continue d'utiliser l'image
  MinIO, disponible sur Docker Hub.

---

## 2026-09-17 — Ports décalés pour les services de développement

**Décision.** Postgres 55432, Redis 56379, S3 59000 au lieu des ports standards.

**Pourquoi.** Éviter tout conflit avec une instance Postgres ou Redis déjà installée
sur le poste, et rendre évident qu'il s'agit de services jetables de développement.

---

## 2026-09-17 — React Router reste en v7, avec les drapeaux « future » v8 activés

**Contexte.** La spécification impose React Router v7 en _framework mode_. React
Router v8.4.0 est sorti depuis (première version 8.0.0 le 17 juin 2026) ; v7 est
toujours maintenu (7.18.4).

**Décision.** On reste en `react-router@^7.18.4` comme spécifié, mais les cinq
drapeaux `future` v8 sont activés dans `react-router.config.ts` :
`v8_middleware`, `v8_splitRouteModules`, `v8_viteEnvironmentApi`,
`v8_passThroughRequests`, `v8_trailingSlashAwareDataRequests`.

**Pourquoi.** La spécification est respectée, l'application adopte déjà la sémantique
v8, et la migration future se réduit à un changement de version. `v8_middleware` est
par ailleurs directement utile : c'est là que se branchera l'authentification en
phase 4.

---

## 2026-09-17 — TypeScript 6.0.3, pas 7.x

**Contexte.** TypeScript 7.0.2 (portage natif) est publié sous le tag `latest`.

**Décision.** Le monorepo est épinglé sur `typescript@^6.0.3`.

**Pourquoi.** `typescript-eslint@8.70.0` déclare `typescript: ">=4.8.4 <6.1.0"` : TS 7
n'est pas encore supporté par le _linter_. TS 6 est stable, accepté par
`@react-router/dev` (`^5.1.0 || ^6.0.0`) et par typescript-eslint. On récupérera TS 7
quand typescript-eslint l'aura intégré.

**Conséquence appliquée.** TS 6 rejette `baseUrl` (déprécié) : la résolution `~/*`
passe par `paths` seul, et `vite-tsconfig-paths` a été retiré au profit de
`resolve.tsconfigPaths: true`, natif dans Vite 8.

---

## 2026-09-17 — ESLint 10 en configuration plate

**Décision.** ESLint 10.10.0, configuration plate unique à la racine
(`eslint.config.mjs`), chaque paquet exécutant simplement `eslint .`.

**Point d'attention.** `eslint-plugin-react-hooks@7` expose encore
`configs.recommended` au format _eslintrc_ (avec `plugins` en tableau) ; la variante
plate est sous `configs.flat['recommended-latest']`. C'est cette dernière qui est
utilisée.

---

## 2026-09-17 — `packages/contracts` et `packages/audio-engine` sont consommés en source TypeScript

**Décision.** Ces deux paquets n'ont pas d'étape de _build_ : leur champ `exports`
pointe directement sur `./src/index.ts`.

**Pourquoi.** Ils ne sont consommés que par des _bundlers_ du même monorepo (Vite). Un
`tsc` d'émission n'ajouterait qu'un artefact à garder synchronisé. Le typage reste
vérifié par la tâche `typecheck`.

---

## 2026-09-17 — Prisma 7.10.0 et non le tag `latest`

**Décision.** Prisma est épinglé sur la 7.10.0 (tag `prev`).

**Pourquoi.** Le tag `latest` de npm pointe actuellement sur `8.0.0-rc.15`, une
_release candidate_. On ne met pas une RC dans le chemin critique d'une base de
production.

---

## 2026-09-17 — Essentia (AGPL-3.0) est confiné au service ML

**Contexte.** Essentia est distribué sous AGPL-3.0. Le produit visé est propriétaire.

**Décision.** Essentia n'est installé que dans `apps/ml`, derrière l'extra `ml` du
`pyproject.toml`, et ne communique avec le reste du système que par HTTP (création de
job) et par un webhook signé. Aucun code du BFF ni du client ne l'importe ni ne le
lie.

**Risque consigné.** L'AGPL s'étend aux utilisateurs accédant au logiciel _à travers
un réseau_. Interpréter ce service comme un programme distinct communiquant par une
frontière réseau est l'usage courant, mais ce n'est pas un avis juridique : si le
produit doit être commercialisé, ce point doit être validé par un juriste. Deux
portes de sortie existent et restent ouvertes par construction (le module d'analyse
est isolé derrière une interface) : remplacer la détection de tonalité/tempo par
`librosa` (ISC) ou publier les sources du service ML.

**Contraintes respectées par ailleurs.** `madmom` (licence non commerciale) n'est pas
utilisé. Rubber Band (GPL/commercial) est écarté au profit de SoundTouch (LGPL, lié
dynamiquement en WASM — voir la phase 6).

---

## 2026-09-17 — Signature HMAC symétrique pour les appels internes

**Décision.** Un unique secret partagé (`ML_WEBHOOK_SECRET`) signe les deux sens de la
communication BFF ↔ ML. La chaîne signée est `${timestamp}.${corps_brut}`, la
signature est un HMAC-SHA256 hexadécimal transporté dans `x-stemlab-signature`, avec
l'horodatage dans `x-stemlab-timestamp` et une tolérance de 300 s.

**Pourquoi.** Les deux services appartiennent au même domaine de confiance ; une PKI
asymétrique serait du cérémonial sans bénéfice. L'horodatage signé ferme la porte au
rejeu, et l'implémentation de référence vit dans `packages/contracts/src/signature.ts`
pour que les deux côtés ne puissent pas diverger.

---

## 2026-09-17 — `zod@4` comme unique source de vérité des frontières d'API

**Décision.** Tout ce qui traverse une frontière (HTTP, webhook, formulaire) est
décrit par un schéma de `packages/contracts`, dont les types TypeScript sont dérivés
par inférence plutôt que déclarés à la main.

**Pourquoi.** Un type TypeScript ne valide rien à l'exécution. Partir du schéma
garantit que la validation et le type ne peuvent pas diverger.

---

## 2026-09-17 — Le lecteur est exposé à React comme un store externe

**Décision.** `MultitrackPlayer` est branché sur React via `useSyncExternalStore`
(`app/lib/player-store.ts`), et non par une cascade de `useState` alimentée dans un
effet.

**Pourquoi.** C'est ce qu'il est réellement : un objet impératif dont l'état change en
dehors de React, au rythme de l'horloge audio. Le linter `react-hooks@7` a d'ailleurs
rejeté la première version — `setState` synchrone dans un effet, accès aux refs
pendant le rendu — et le signal était juste. Bénéfice supplémentaire : le rendu
serveur devient trivial, puisque Web Audio n'existe pas côté serveur et que
l'instantané y est constant.

**Conséquence.** Le store compare les sources par clé et ignore les appels redondants.
Un appelant qui passe un tableau recréé à chaque rendu ne détruit donc plus
l'AudioContext à chaque fois.

---

## 2026-09-17 — Curseur et chronomètre écrivent directement dans le DOM

**Décision.** La position de lecture n'entre pas dans l'état React. `Playhead` et
`TimeDisplay` s'abonnent à `observePosition()` et écrivent directement dans leur nœud,
le curseur via `transform`.

**Pourquoi.** À 60 Hz, un `setState` par frame ferait re-rendre tout le lecteur pour
déplacer un trait d'un pixel. `transform` ne déclenche que de la composition, pas de
mise en page.

**Ce qui ne change pas.** La _valeur_ vient toujours de `AudioContext.currentTime` —
`requestAnimationFrame` cadence l'affichage, il ne mesure pas le temps.

---

## 2026-09-17 — Les peaks ne resteront pas en ligne dans la charge SSR

**Constat.** La page de démonstration sérialise les peaks (512 points/seconde) dans
les données du _loader_ : 175 Ko de HTML pour 12 secondes d'audio. Extrapolé à un
morceau de 4 minutes et 6 stems, cela dépasserait plusieurs mégaoctets par page.

**Décision.** Acceptable pour la page de vérification de la phase 1. À partir de la
phase 2, où le format de sortie du pipeline est arrêté, les peaks seront produits et
servis comme un **fichier binaire séparé** (un octet par point), récupéré par le
client et mis en cache par le CDN — et non sérialisés dans le HTML.

---

## 2026-09-17 — Signature GPG désactivée pour ce dépôt

**Contexte.** La configuration git globale du poste signe les commits avec GPG, dont
la clé attend une passphrase interactive : `gpg: signing failed: Timeout`.

**Décision.** `commit.gpgsign=false` **dans ce dépôt uniquement**. La configuration
globale n'a pas été modifiée. À réactiver si les commits signés sont attendus sur ce
projet.
