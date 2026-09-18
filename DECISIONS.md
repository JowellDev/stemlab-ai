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

**Décision.** Acceptable pour la page de vérification de la phase 1.

_Précision apportée en phase 2_ : la spécification demande explicitement que les
peaks figurent dans le JSON produit par le pipeline, et c'est bien le cas. Le
problème ne concerne donc pas la sortie du pipeline mais la **couche de service** :
à partir de la phase 4, le BFF ne sérialisera pas les peaks dans la charge SSR ; il
les exposera comme une ressource binaire séparée (un octet par point), récupérée par
le client et mise en cache par le CDN.

---

## 2026-09-17 — Signature GPG désactivée pour ce dépôt

**Contexte.** La configuration git globale du poste signe les commits avec GPG, dont
la clé attend une passphrase interactive : `gpg: signing failed: Timeout`.

**Décision.** `commit.gpgsign=false` **dans ce dépôt uniquement**. La configuration
globale n'a pas été modifiée. À réactiver si les commits signés sont attendus sur ce
projet.

---

## 2026-09-17 — Le verrou Python cible le CPU ; le GPU est l'affaire de Modal

**Constat.** Les roues PyPI de `torch` embarquent les bibliothèques CUDA : la
première installation a téléchargé plus de 4 Go dont rien n'était utilisable sur une
machine sans GPU.

**Décision.** `apps/ml/pyproject.toml` épingle `torch` et `torchaudio` sur l'index
`https://download.pytorch.org/whl/cpu`. L'environnement complet descend à **1,2 Go**.
L'image du worker GPU, construite par Modal (phase 9), installera la variante CUDA de
son côté.

**Pourquoi c'est le bon découpage.** Le verrou du dépôt décrit ce qui tourne en
développement et en CI, c'est-à-dire du CPU. Le GPU n'apparaît que dans un artefact
de déploiement, où il est effectivement disponible.

---

## 2026-09-17 — Le bin 0 du HPCP d'Essentia est un _la_, pas un _do_

**Contexte.** La fréquence de référence par défaut du HPCP est 440 Hz. Le premier bin
du chromagramme correspond donc à un la, alors que tout le reste du système raisonne
en do. La documentation ne le dit pas sans ambiguïté.

**Ce qui s'est passé.** La première version appliquait une rotation déduite du
raisonnement, et elle était fausse : **tous** les accords sortaient transposés, sans
qu'aucun test ne le détecte. Le symptôme est silencieux — la sortie reste plausible.

**Décision.** La valeur a été **mesurée** en faisant passer les douze notes
chromatiques dans l'extracteur, et le test
`test_le_chromagramme_est_aligne_sur_do` la revérifie pour chacune des douze. La
constante `HPCP_ROLL_TO_C` porte la mesure, pas le raisonnement.

**Leçon retenue et appliquée ailleurs.** Quand une convention d'une bibliothèque
externe conditionne toute une chaîne, on la mesure et on épingle la mesure par un
test — on ne la déduit pas.

---

## 2026-09-17 — La détection d'accords décode par temps, pas par trame

**Décision.** Le chromagramme est agrégé **par intervalle entre deux temps** (médiane)
avant le décodage de Viterbi, au lieu d'être décodé trame par trame.

**Pourquoi.** Deux bénéfices, tous deux vérifiés sur les morceaux de test :

1. La médiane écarte les transitoires percussifs, qui ne durent qu'une trame ou deux
   et ne portent aucune hauteur.
2. Le coût de transition prend enfin un sens musical : il s'exprime par temps, et non
   par tranche de 46 ms où il ne voulait rien dire.

C'est la pratique établie en reconnaissance d'accords, et le passage a fait tomber le
nombre de segments parasites d'un facteur trois sur le morceau de test « électro ».

### Deux réglages qui ont demandé une correction

**Le coût de transition n'est pas une probabilité normalisée.** La première version
utilisait `log((1 - p) / (n_états - 1))`, soit ≈ 6,8 nats par changement quel que
soit le contexte — assez pour figer la sortie sur un unique accord dès que les
observations sont peu nombreuses. Il est désormais exprimé comme un **coût explicite
en nats**, avec deux valeurs : 2,5 en décodage synchrone aux temps, 12 en repli trame
par trame. Une observation ne représente pas la même chose dans les deux modes.

**Les similarités cosinus sont mal calibrées comme vraisemblances.** L'écart entre un
accord juste (1,0) et un accord proche mais faux (0,87) ne pèse presque rien en
logarithme. Sans correction, le lissage fusionnait les accords partageant des notes :
une suite Am–F devenait un unique Fmaj7. Un exposant (`DEFAULT_SHARPNESS = 10`) est
appliqué aux scores avant le décodage.

---

## 2026-09-17 — Bande d'analyse resserrée à 55–2000 Hz pour le chromagramme

**Décision.** Les pics spectraux alimentant le HPCP sont limités à 55 Hz–2 kHz, au
lieu de 40 Hz–5 kHz.

**Pourquoi.** Le fondamental d'une grosse caisse balaie typiquement 40 à 130 Hz. Une
descente en fréquence n'a pas de hauteur définie : elle étale son énergie sur les
douze bandes et brouille la détection. 55 Hz (la1) reste sous la plus basse note
jouable par une basse à quatre cordes. Au-delà de 2 kHz, il n'y a plus que des
harmoniques, que le HPCP replie déjà par son paramètre `harmonics`.

---

## 2026-09-17 — La tonalité est arbitrée par les accords détectés

**Problème.** Une tonalité mineure et son relatif majeur ont exactement la même
armure, donc le même profil de hauteurs. Aucun estimateur fondé sur le profil ne peut
les distinguer. Sur les trois morceaux de test, Essentia a rendu le relatif majeur
dans les deux cas mineurs.

**Décision.** `refine_key_with_chords()` tranche a posteriori à partir des accords
détectés, sur deux indices musicalement établis :

1. **L'accord de tonique est le plus joué** — durée cumulée.
2. **Une pièce commence et se termine sur sa tonique** — le premier et le dernier
   accord pèsent trois fois plus.

En cas d'égalité, la réponse de l'estimateur est conservée : il n'y a pas de raison
de la contredire sans marge franche.

**Résultat mesuré.** 3 tonalités correctes sur 3, contre 1 sur 3 avant.

---

## 2026-09-17 — Les morceaux de test sont regénérés, pas versionnés

**Décision.** `scripts/make-test-tracks.py` synthétise trois morceaux (rock, électro,
ballade) dans trois formats (WAV, MP3, FLAC). Les fichiers audio ne sont **pas**
committés ; seules les analyses tronquées le sont, comme fixtures de contrat.

**Pourquoi.** Les générateurs sont à graine fixe : la sortie est identique d'une
exécution à l'autre, et 4 Mo d'audio n'ont rien à faire dans l'historique git. Tout
étant synthétisé, il n'y a par ailleurs aucun enjeu de droits — et la vérité terrain
(tonalité, tempo, grille d'accords) est connue exactement, ce qui permet de juger la
sortie autrement qu'à l'oreille.

**Limite assumée.** Demucs est entraîné sur de la musique réelle. Sur du matériel
synthétique, il répartit le contenu entre les stems de façon peu représentative. Ces
morceaux valident **l'enchaînement du pipeline**, pas la qualité de la séparation.

---

## 2026-09-17 — Un jeu de vecteurs partagé garantit que les deux signatures concordent

**Problème.** La signature HMAC existe en deux implémentations : TypeScript
(`packages/contracts/src/signature.ts`) et Python (`apps/ml/src/ml/security.py`).
Chacune peut passer ses propres tests tout en étant incompatible avec l'autre — un
encodage UTF-8 différent, une sérialisation qui diffère d'un espace, et tout le canal
interne tombe.

**Décision.** `fixtures/signature-vectors.json` contient sept triplets
`(secret, corps, horodatage) → signature`, couvrant le corps vide, l'UTF-8 hors ASCII,
un corps de 4 Ko, des guillemets et des sauts de ligne dans le secret. **Les deux
suites de tests les vérifient.** Si les deux passent, les deux implémentations
concordent — ce qu'aucun test purement local ne peut établir.

---

## 2026-09-17 — L'idempotence est indexée par `(checksum, modèle)`

**Décision.** Le cache de résultats est indexé par le couple, pas par le seul
checksum.

**Pourquoi.** Le même fichier séparé en six stems n'est pas le même résultat qu'en
quatre. Indexer sur le seul checksum rendrait un résultat à quatre stems à une demande
qui en attendait six.

**Comportement en cas de doublon.** Le webhook de succès est **rejoué à l'identique**
plutôt que d'être remplacé par une réponse « déjà fait ». Le BFF reçoit exactement ce
qu'il aurait reçu d'un vrai traitement : un seul chemin de code à écrire de son côté.

---

## 2026-09-17 — Le webhook est ré-horodaté à chaque tentative

**Décision.** Le corps est signé à neuf avant chaque envoi, pas une fois pour toutes.

**Pourquoi.** Les reessais s'étalent sur une trentaine de secondes. Avec une fenêtre
de tolérance de 300 s ce n'est pas encore un problème, mais une politique de reessais
plus longue ferait expirer l'horodatage — et le BFF rejetterait une livraison
parfaitement légitime. Le coût est un HMAC de plus par tentative.

**Ce qui n'est pas réessayé.** Une réponse 4xx de validation : le corps ne deviendra
pas valide en le renvoyant. Seuls 5xx, 408, 425 et 429 déclenchent une nouvelle
tentative.

---

## 2026-09-17 — Un redémarrage du worker remet le job en file, sans attendre le délai d'expiration

**Décision.** `retry_jobs = True` avec le gestionnaire de signal par défaut d'ARQ.

**Comment cela fonctionne.** Sur `SIGTERM`, ARQ annule les tâches en cours ; une
`CancelledError` avec `retry_jobs` remet immédiatement le job en file. **Vérifié par
exécution** : un job interrompu à 10 % a repris à l'essai 2 sur un worker neuf et
s'est terminé normalement.

**L'alternative écartée.** `job_completion_wait=True` fait attendre la fin des jobs
avant de s'arrêter. Pour un worker GPU en _scale-to-zero_, cela bloquerait l'arrêt
jusqu'à dix minutes. Remettre en file est plus rapide et plus sûr.

**Limite connue.** Le pipeline tourne dans un thread d'exécuteur : annuler la tâche
asyncio ne l'interrompt pas. Le thread meurt avec le processus, ce qui est le cas à
l'arrêt — mais un `SIGKILL` laisserait le job invisible jusqu'à l'expiration de sa clé
« en cours », soit `job_timeout + 10 s`.

---

## 2026-09-17 — Les erreurs de validation ne renvoient pas l'entrée reçue

**Décision.** `error.errors(include_url=False, include_input=False,
include_context=False)`, remis à la forme `{champ: [messages]}` des contrats.

**Deux raisons.** Le contexte pydantic porte des objets Python non sérialisables — le
service renvoyait une 500 en tentant de décrire une 400. Et renvoyer l'entrée ferait
du service un écho pour qui le sonde.

---

## 2026-09-17 — `create_app()` plutôt qu'une application globale

**Décision.** L'application FastAPI est construite par une fabrique qui accepte les
trois dépendances externes (configuration, Redis, file). L'instance servie par uvicorn
n'est qu'un appel par défaut de cette fabrique.

**Pourquoi.** Cela permet de tester la surface HTTP contre un Redis en mémoire et une
file factice, **sans rien simuler du code testé lui-même** — seules les frontières
externes sont substituées. La fabrique ne ferme que ce qu'elle a ouvert : une
dépendance injectée appartient à l'appelant.

---

## 2026-09-18 — Le SDK AWS v3 rend les URL présignées inutilisables par défaut

**Symptôme.** Tout `PUT` vers une URL présignée était rejeté : `BadDigest` sur
SeaweedFS, `InvalidDigest ... algorithm Crc32` sur une autre implémentation S3. Les
requêtes signées classiques passaient, elles, sans problème.

**Cause.** Depuis fin 2024, le SDK JavaScript v3 joint un checksum CRC32 à chaque
envoi (`requestChecksumCalculation: "WHEN_SUPPORTED"`). Sur une URL présignée, la
signature exige alors un en-tête que le navigateur ne produit pas, et le stockage
rejette le dépôt.

**Décision.** `requestChecksumCalculation` et `responseChecksumValidation` sont mis à
`WHEN_REQUIRED` sur le client S3.

**Ce que ça a coûté.** Le diagnostic est parti dans la mauvaise direction : soupçonner
l'implémentation S3 locale, télécharger une alternative, la configurer entièrement.
C'est seulement en réessayant l'implémentation d'origine **avec le correctif** que le
bug s'est révélé être entièrement de notre côté. La leçon : quand deux implémentations
indépendantes échouent de la même façon, l'erreur est presque toujours dans le code
appelant.

---

## 2026-09-18 — L'authentification passe par des actions serveur

**Décision.** L'inscription et la connexion sont traitées par des `action` React
Router appelant l'API serveur de better-auth, et non par son client navigateur.

**Pourquoi.** Le test de bout en bout échouait de façon intermittente : un clic
arrivant avant l'hydratation partait en soumission native, sans gestionnaire
JavaScript pour l'intercepter. Ce n'était pas un défaut du test — c'est exactement ce
que vit un utilisateur sur une connexion lente. Une action serveur supprime la course
et fait fonctionner les deux formulaires sans JavaScript.

**Effet de bord bienvenu.** `redirectTo` est validé côté serveur
(`app/lib/redirect.server.ts`) : seuls les chemins internes sont acceptés, ce qui
ferme une redirection arbitraire après authentification.

---

## 2026-09-18 — Le statut « en file » est posé avant l'appel au service ML

**Bug trouvé par l'exécution.** Un morceau dédupliqué restait bloqué sur « en file ».
Le service ML rejoue le webhook de succès **pendant** l'appel de création de job : le
morceau passait donc à `ready`, puis la transaction qui suivait le remettait à
`queued`.

**Décision.** Le morceau est marqué « en file » _avant_ l'appel, et par une mise à
jour conditionnelle (`where: { status: { in: ['uploaded', 'failed'] } }`) : un statut
plus avancé n'est jamais écrasé. En cas d'échec de l'appel, le morceau est marqué en
erreur plutôt que laissé en file pour un traitement qui n'arrivera pas.

---

## 2026-09-18 — La déduplication recopie les stems sous le préfixe du demandeur

**Bug lié au précédent.** Le cache d'idempotence rendait des stems stockés sous le
préfixe du **premier** traitement. Le demandeur recevait des clés qu'il ne possède
pas, et que la suppression de l'autre morceau ferait disparaître sous ses pieds.

**Décision.** À la déduplication, les stems sont recopiés côté stockage
(`CopyObject`) sous le préfixe demandé, et les clés réécrites. Une copie serveur reste
sans commune mesure avec le coût d'une séparation GPU. Si les objets mémorisés ont
disparu, l'entrée de cache est oubliée et le morceau retraité normalement.

---

## 2026-09-18 — Les dépendances lourdes sont un groupe uv, pas un extra

**Bug trouvé par l'exécution.** Le worker plantait sur `ModuleNotFoundError: torch`
alors que torch était installé. En cause : `uv run` resynchronise l'environnement à
chaque appel et **retire** un extra qui n'est pas demandé sur cette ligne de commande.

**Décision.** `torch`, `torchaudio`, `demucs` et `essentia` passent d'un
`optional-dependencies` à un `dependency-group` listé dans
`tool.uv.default-groups`. Un groupe par défaut, lui, reste en place quelle que soit
la commande.

---

## 2026-09-18 — Découpage du monorepo : `packages/database` et `packages/ui`

**Décision.** Deux paquets supplémentaires :

- **`@stemlab/database`** — schéma Prisma, migrations, client généré et fabrique de
  connexion. Le paquet ne lit pas l'environnement : la chaîne de connexion lui est
  passée par l'application, qui l'a déjà validée. Une configuration invalide échoue
  donc au démarrage, pas au premier accès à la base.
- **`@stemlab/ui`** — composants shadcn/ui et thème. La feuille de style porte à la
  fois les jetons sémantiques de shadcn et ce qui nous appartient : la couleur de
  marque et **une couleur par type de stem**. Cette dernière est lue par le canvas des
  formes d'onde, ce qui garantit que l'interface et le tracé ne peuvent pas diverger.

**Point d'attention.** `accent` est un jeton réservé par shadcn (survol discret). Le
cyan de STEMLAB a donc été renommé `brand`, et `--primary` pointe dessus pour que les
boutons soient sur la marque sans détourner un jeton sémantique.

---

## 2026-09-18 — Le flux d'état de la bibliothèque relit la base

**Décision.** Le flux SSE interroge la base toutes les 1,5 s et n'émet que les
changements, plutôt que de s'appuyer sur un bus d'événements en mémoire.

**Pourquoi.** Le webhook du worker peut atterrir sur une instance et le flux SSE vivre
sur une autre — ce sera le cas dès le déploiement multi-région de la phase 9. Un bus
en mémoire laisserait alors l'utilisateur devant une barre de progression figée. Une
requête indexée coûte beaucoup moins cher qu'un bus distribué, et reste correcte
quelle que soit la topologie.

---

## 2026-09-18 — Organisation des routes et langue

**Décision.** Les routes sont groupées par nature — `routes/auth/`,
`routes/dashboard/`, `routes/api/` — et **nommées en anglais**, URL comprises
(`/login`, `/signup`, `/library`, `/tracks/:id`). Les textes affichés restent en
français : c'est la langue du produit, pas celle du code.
