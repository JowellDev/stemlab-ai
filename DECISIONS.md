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

---

## 2026-09-18 — `packages/music` : la théorie musicale, pure et testable

**Décision.** Transposition, orthographe des hauteurs, recherche de l'élément actif et
construction de la grille de mesures vivent dans un paquet dédié, sans dépendance à
React ni à Web Audio.

**Pourquoi pas dans `audio-engine`.** Transposer un libellé d'accord n'a rien à voir
avec Web Audio. Séparer les deux garde `audio-engine` centré sur ce qu'il fait — la
synchronisation — et rend la théorie musicale testable sans le moindre simulacre.

---

## 2026-09-18 — La position est exprimée dans le temps du morceau

**Constat.** C'est ce qui rend l'alignement des accords gratuit sous changement de
tempo.

`positionAt()` calcule `offset + écoulé × vitesse`. À 75 %, quatre secondes d'horloge
donnent trois secondes de morceau. La position rendue est donc **toujours** dans le
référentiel de l'analyse, jamais dans celui de la restitution. Aucun réalignement
n'est nécessaire — et c'est précisément ce que vérifie le test de la DoD.

**Corollaire pour le changement de vitesse.** L'horloge doit être ré-ancrée sur la
position courante au moment du changement : sans cela, tout le temps déjà écoulé
serait réinterprété à la nouvelle vitesse et la position ferait un saut.

---

## 2026-09-18 — L'orthographe des hauteurs suit l'armure

**Décision.** Une même touche s'écrit `F#` ou `Gb` selon la tonalité. L'orthographe
retenue est celle de l'armure de la tonalité obtenue **après** transposition.

**Pourquoi ça compte.** Transposer ré majeur d'un demi-ton donne mi bémol majeur :
écrire `D#` y serait faux pour un musicien. Un test écrit naïvement a d'ailleurs
échoué sur ce point — c'est l'application qui avait raison.

**Cas d'égalité.** À six altérations, les deux graphies se valent. On tranche par
l'usage : `F#` majeur et `Ebm` mineur.

---

## 2026-09-18 — La grille de mesures est calée sur les changements d'accord

**Problème observé à l'écran.** La grille était décalée d'une demi-mesure. La phase
des temps forts venait de l'énergie, et une batterie régulière — un quatre-à-la-noire,
par exemple — répartit la même énergie sur tous les temps : l'heuristique n'avait rien
pour trancher.

**Décision.** Le pipeline construit désormais la grille **après** la détection
d'accords, et choisit la phase qui place le plus de changements d'accord sur un temps
fort. Une harmonie change presque toujours sur un temps fort ; c'est un indice bien
plus fiable que l'énergie. L'énergie reste le repli quand les changements sont trop
rares ou trop dispersés pour trancher.

**Résultat mesuré.** Sur la ballade, le premier temps fort tombe à 3,135 s — exactement
sur un changement d'accord.

---

## 2026-09-18 — Le suivi de lecture ne passe pas par l'état React

**Décision.** Les vues d'accords s'abonnent à la position et n'écrivent que des
attributs DOM (`data-active`), sans re-rendu.

**Pourquoi.** La recherche est une dichotomie — négligeable — mais elle tourne à
chaque frame. Le rappel n'est déclenché que lorsque l'élément actif **change** : un
accord durant plusieurs secondes, cela représente une notification pour trois cents
frames muettes.

**Défilement.** Il suit les changements d'accord, pas chaque frame. Un recentrage
continu donnerait un mouvement flottant, désagréable à suivre.

---

## 2026-09-18 — Deux corrections d'accessibilité trouvées par les tests mobiles

**Le nom accessible disparaissait sous 640 px.** Les boutons de vue portaient leur
libellé dans un `<span class="hidden sm:inline">` : à 390 px, ils n'avaient plus
aucun nom. Un `aria-label` permanent corrige le problème, et c'est le test mobile qui
l'a révélé.

**Les curseurs n'avaient pas de nom.** Dans un slider Radix, c'est la **poignée** qui
porte le rôle `slider`, pas la racine : un `aria-label` posé sur le composant
n'atteint aucune technologie d'assistance. Le composant partagé expose désormais
`thumbLabel`, qui le transmet à chaque poignée.

---

## 2026-09-18 — Les tests localisent la position par un identifiant stable

**Décision.** L'affichage de position porte `data-testid="playback-position"`.

**Pourquoi.** Les tests le trouvaient jusque-là par une classe utilitaire
(`p.tabular-nums span`), qui a changé au premier remaniement de style — et qui
désignait deux éléments. Une valeur dynamique que plusieurs suites doivent lire mérite
un point d'ancrage explicite.

---

## 2026-09-18 — Écart à la spécification : Signalsmith Stretch (MIT/WASM) au lieu de SoundTouch (LGPL)

**Ce que demandait la spécification.** « Intégration de SoundTouch compilé en WASM
dans un AudioWorklet (licence LGPL — lien dynamique, à documenter dans
DECISIONS.md) ».

**Le problème.** La spécification demande une chose qui n'existe pas sous cette
forme, et pour une raison qui se retourne contre elle.

1. **Il n'existe pas de portage WASM de SoundTouch publié.** Les paquets disponibles
   sont `soundtouchjs` et `soundtouch-ts` — des réécritures en JavaScript, pas du
   WASM. Obtenir du WASM exigerait de compiler la bibliothèque C++ avec Emscripten,
   absent de l'environnement, et de maintenir cette chaîne de compilation.
2. **Le « lien dynamique » n'a pas de sens ici.** La LGPL autorise l'usage dans un
   produit propriétaire à condition que la bibliothèque reste remplaçable par
   l'utilisateur. Un module WASM empaqueté dans un _bundle_ navigateur est un lien
   statique déguisé : l'exigence de la LGPL serait au mieux discutable. La
   spécification écartait déjà Rubber Band pour sa GPL — ce souci de licence est
   précisément ce qui disqualifie aussi ce montage.
3. **Un portage JavaScript ne tiendrait pas la Definition of Done.** Étirer six flux
   stéréo en temps réel, par tranches de 128 échantillons, sans accroc sur un
   processeur de milieu de gamme, demande du code natif.

**Décision.** **Signalsmith Stretch** (`signalsmith-stretch`, 1.3.2) :

| Critère               | SoundTouch (portage JS)            | Signalsmith Stretch                      |
| --------------------- | ---------------------------------- | ---------------------------------------- |
| Licence               | LGPL-2.1 — contrainte à documenter | **MIT** — aucune contrainte              |
| Implémentation        | JavaScript                         | **WASM**, comme demandé                  |
| AudioWorklet          | à écrire                           | **fourni**                               |
| Lecture depuis tampon | à écrire                           | **fournie** — le nœud remplace la source |

La bibliothèque satisfait **les deux** intentions de la spécification — du WASM, et
pas de licence contaminante — mieux que ce qu'elle nommait. Rubber Band reste écarté,
conformément à la contrainte d'origine.

**Bénéfice architectural, imprévu et décisif.** Le nœud accepte _n_ canaux et les
étire **ensemble**, sous une analyse unique. Toutes les pistes deviennent les canaux
d'un seul nœud : la dérive entre pistes n'est plus une propriété à surveiller, elle
est **structurellement impossible** — les canaux ne sont même pas suivis séparément.
Avec une instance par piste, comme l'imposerait SoundTouch (limité à deux canaux), il
aurait fallu prouver que _n_ instances restent verrouillées.

---

## 2026-09-18 — Un moteur de restitution, deux implémentations

**Décision.** Le lecteur ne produit plus le son lui-même : il délègue à un
`PlaybackEngine`. Deux implémentations :

- **`StretchEngine`** — le nœud WASM. Tempo et hauteur indépendants.
- **`BufferSourceEngine`** — des `AudioBufferSourceNode` classiques. La vitesse passe
  par `playbackRate`, ce qui **déplace aussi la hauteur** : c'est le comportement
  d'une bande magnétique.

**Pourquoi un repli.** Un AudioWorklet peut échouer à se charger : navigateur trop
ancien, politique de sécurité bloquant le `Blob:` du module, WASM refusé. Mieux vaut
une lecture dégradée qu'aucune lecture. Le repli est **annoncé** par
`supportsIndependentPitch`, et l'interface le dit à l'utilisateur plutôt que de
laisser un réglage sans effet.

**Ce que le lecteur garde.** L'horloge, le transport, le mixage, les événements. Le
moteur ne s'occupe que du son. C'est cette séparation qui a permis de remplacer toute
la mécanique d'étirement sans toucher à la logique de lecture.

---

## 2026-09-18 — L'avance de démarrage est négociée avec le moteur

**Problème.** Le lecteur ancre son horloge sur l'instant de démarrage demandé. Le
nœud d'étirement, lui, compense sa propre latence et exige une avance d'environ
250 ms — bien plus que les 80 ms de lookahead du lecteur. Démarrer plus tard que
l'horloge ne le croit aurait produit un décalage permanent entre la position affichée
et ce qu'on entend.

**Décision.** Le moteur déclare son besoin (`startLead`), et le lecteur retient
`max(lookahead, startLead)`. L'horloge est ancrée sur cet instant : le son commence
donc exactement là où elle l'attend.

---

## 2026-09-18 — `numberOfInputs: 0` empêche le processeur de tourner

**Symptôme.** Le nœud s'instanciait, acceptait ses tampons, acceptait sa
planification — et ne produisait rien. `inputTime` restait à zéro.

**Cause.** Chrome n'exécute pas le `process()` d'un `AudioWorkletNode` déclaré sans
entrée, même lorsque ce nœud est une source. Diagnostic obtenu en isolant les
variables une à une : 2 canaux / 8 canaux, avec entrée / sans entrée.

| entrées | canaux | résultat   |
| ------- | ------ | ---------- |
| 1       | 2      | ✅         |
| 0       | 2      | ❌ silence |
| 1       | 8      | ✅         |
| 0       | 8      | ❌ silence |

**Décision.** Une entrée est déclarée et laissée non connectée.

---

## 2026-09-18 — La dérive se mesure par rendu hors-ligne

**Décision.** Le banc de mesure (`/dev/drift`, exercé par `e2e/drift.spec.ts`) rend
l'audio dans un `OfflineAudioContext`, à travers le **vrai** moteur de l'application.

**Pourquoi.** Cinq minutes d'audio se rendent en une trentaine de secondes, et le
chemin vérifié est celui réellement emprunté en production — pas une reconstitution.
Chaque piste reçoit des impulsions aux mêmes instants ; après étirement, leurs
positions doivent coïncider à l'échantillon près.

**Résultat.** 300 s d'entrée à 75 % et −3 demi-tons, 8 canaux : **0 échantillon
d'écart** sur tous les événements mesurés. Idem aux bornes des réglages (50 % / +12,
150 % / −12).

**Limite du banc.** Le rendu de cinq minutes sur huit canaux occupe plus de 500 Mo :
il ne tourne que sur un format d'affichage, et les mesures du fichier s'exécutent en
série. Une première version, parallélisée, échouait par épuisement mémoire — le rendu
sortait silencieux plutôt que d'échouer franchement.

---

## 2026-09-18 — Les tests de synchronisation changent d'objet

**Constat.** `sync.spec.ts` instrumentait `AudioBufferSourceNode.start()` pour
vérifier que les quatre pistes recevaient le même instant. Ce mécanisme n'existe plus
sur le chemin principal : il n'y a plus de source par piste.

**Décision.** Le fichier vérifie désormais ce qui reste observable de l'extérieur :

- **aucune** source de tampon n'est créée — preuve que le moteur d'étirement est bien
  celui qui tourne ;
- la position est exacte après chaque seek ;
- l'écart entre horloge audio et position affichée reste constant.

La garantie inter-pistes, elle, a changé de nature : elle est mesurée par
`drift.spec.ts` et garantie par construction. Les tests unitaires du moteur de repli
continuent de vérifier l'instant partagé, qui reste sa propriété.

---

## 2026-09-18 — Le repli hors ligne est une page statique, pas une route

**Constat.** Le service worker sert la page de repli sous l'URL demandée. Si cette
page est le rendu serveur d'une route React Router, le client l'hydrate contre une
**autre** route que celle qui a produit le HTML, et bascule sur la frontière
d'erreur : l'utilisateur hors réseau lit « Une erreur est survenue » au lieu de
« Hors connexion ».

**Décision.** `public/offline.html` — aucun script, aucune requête, précachée comme un
fichier ordinaire. La route `routes/offline.tsx` est supprimée.

**Conséquence assumée.** Cette page ne peut pas lister les morceaux déjà téléchargés :
elle n'exécute rien. Elle renvoie vers la bibliothèque, qui, elle, est une page
applicative mise en cache à la visite.

---

## 2026-09-18 — `navigateFallback` de Workbox est neutralisé

**Constat.** Deux comportements de Workbox, tous deux contre-intuitifs :

1. `navigateFallback` enregistre sa route **avant** celles de `runtimeCaching`, et le
   routeur retient la première qui correspond. Hors ligne, la page d'un morceau
   pourtant présente dans le cache `pages` n'était jamais servie.
2. `navigateFallback` ne **précache pas** la page qu'il désigne : il la suppose déjà
   dans le manifeste, ce qui n'est vrai que d'un `index.html` produit par le build.

**Décision.** La déclaration est conservée — elle fait entrer la page dans le
précache — mais sa route est rendue inopérante par `navigateFallbackDenylist: [/./]`,
et le repli est recâblé après la tentative réseau puis le cache, par
`precacheFallback` sur la route de navigation.

**Pourquoi pas `injectManifest`.** Un service worker écrit à la main donnerait un
contrôle total et supprimerait cette ruse. Il ajoute en échange un point d'entrée à
maintenir, ses propres dépendances Workbox et une configuration TypeScript
« webworker ». À reconsidérer si la phase 8 demande des routes que `generateSW` ne
sait pas exprimer.

---

## 2026-09-18 — La file d'envoi différée distingue refus et panne

**Décision.** Un envoi mis en attente est retiré de la file quand le serveur le
**refuse** (`bad_request`, `forbidden`, `not_found`, `payload_too_large`,
`unsupported_media_type`, `quota_exceeded`) : le réessayer donnerait le même refus, et
le garder encombrerait le stockage de l'appareil. Tout le reste — réseau coupé,
serveur en panne, session à renouveler — laisse le fichier en attente.

La boucle s'arrête au **premier** échec transitoire : si un envoi ne passe pas, les
suivants ne passeront pas davantage, et chaque tentative coûte de la batterie.

**Plafond.** 400 Mo, distinct du budget des morceaux téléchargés. Un envoi en attente
est un fichier source complet ; quatre morceaux de 100 Mo suffisent à saturer un
téléphone. Mieux vaut refuser franchement que faire échouer l'écriture plus tard.

---

## 2026-09-18 — Le score « PWA » de Lighthouse n'existe plus

**Problème dans la spécification.** Elle exige un « score Lighthouse PWA ≥ 90 ». La
catégorie PWA a été **retirée de Lighthouse à partir de la version 12** ; la version
13 ne propose plus que `performance`, `accessibility`, `best-practices`, `seo` et
`agentic-browsing`.

**Correction appliquée.** Les critères que cette catégorie agrégeait sont vérifiés un
à un par `e2e/offline.spec.ts` : manifeste installable, icônes 192/512 et maskable,
service worker actif, fonctionnement hors réseau. Les quatre catégories restantes sont
mesurées et consignées.

**Mesure** (build de production, `/login`, mobile 390 px) : performance 97,
accessibilité 100, bonnes pratiques 100, SEO 100. En format bureau, la performance
tombe à 78 — le préréglage bureau de Lighthouse bride fortement le processeur par
rapport à ses propres seuils ; `TBT` et `CLS` sont à zéro dans les deux cas.

---

## 2026-09-18 — Inter est servie par l'application

**Constat.** La feuille de style `fonts.googleapis.com` est bloquante pour le rendu, et
inaccessible hors ligne — l'interface perdait sa police en mode avion.

**Décision.** Les deux sous-ensembles latins (130 Ko) sont servis depuis
`public/fonts/` et précachés avec le reste. La règle `runtimeCaching` qui mettait en
cache les polices tierces disparaît, faute d'objet.

---

## 2026-09-18 — Un marqueur d'hydratation pour les tests

**Constat.** Le HTML rendu par le serveur est complet avant que React n'attache ses
gestionnaires. Playwright rejoue un clic émis trop tôt ; il ne rejoue **pas** un
`change`. Remplir un champ fichier avant l'hydratation perdait l'événement sans
qu'aucune erreur ne le signale — deux tests échouaient par intermittence.

**Décision.** `<html data-hydrated="true">` est posé par un effet dans `root.tsx`, et
les tests attendent ce marqueur avant toute interaction non rejouable.

**Alternative écartée.** Masquer la zone de dépôt jusqu'à l'hydratation : cela
dégraderait l'affichage initial pour tous les utilisateurs afin de servir un besoin
de test.

---

## 2026-09-18 — Les paroles passent avant la mise en production

**Demande.** Transcription des paroles et traduction français ↔ anglais, demandée
avant la mise en production.

**Décision.** La feuille de route devient : phase 8 durcissement, **phase 9 paroles et
traduction**, phase 10 mise en production. Les phases sont renumérotées en
conséquence dans `PROGRESS.md`.

**Approche retenue.** `faster-whisper` (MIT) sur le stem `vocals` déjà isolé — une voix
débarrassée de la batterie et de la basse se transcrit nettement mieux que le mixage.
Horodatage au mot, calé sur la grille de mesures existante, donc défilement et
navigation par clic comme pour les accords. Whisper traduit nativement vers l'anglais ;
l'anglais vers le français demande un second modèle (NLLB-200 ou M2M-100, licences
permissives à confirmer). Le texte pèse quelques kilo-octets : il part avec le morceau
téléchargé, sans surcoût hors ligne.

---

## 2026-09-18 — Évaluation des fonctionnalités musicales demandées

Sept demandes, trois groupes très inégaux. Consigné ici pour que l'arbitrage soit
explicite avant d'engager le travail.

**Faisable rapidement, sans modèle nouveau**

- **Choix direct d'une tonalité** — le moteur transpose déjà en demi-tons et la
  tonalité est détectée ; il ne manque qu'un sélecteur qui calcule l'écart.
- **Tap tempo** — médiane des intervalles entre frappes, puis réancrage de la grille.
- **Décompte avant lancement** — une ou deux mesures de clics synthétisés sur la
  grille existante.

**Faisable, sous réserve de licence des poids**

- **Voix principale / chœurs** — les modèles « karaoke » (Mel-Band-RoFormer, MDX-Net)
  le font correctement. Le risque n'est pas technique : plusieurs jeux de poids sont
  **non commerciaux**, ce qui rejoint exactement la contrainte posée sur madmom. À
  vérifier avant intégration, et à écarter si la licence ne convient pas.
- **Éléments de batterie** (grosse caisse, caisse claire, toms, charleston, cymbales)
  — LarsNet, entraîné sur StemGMD, fait précisément cela. Même réserve.
- **Repères vocaux par section** — détection de structure par `allin1`, annonce par la
  synthèse vocale du navigateur (multilingue, gratuite, disponible hors ligne sur la
  plupart des plateformes).

**Hors de portée, et il faut le dire**

- **Piano 1 / Piano 2, Guitare 1 / Guitare 2.** Séparer deux instances du **même**
  instrument n'est pas un problème résolu : la séparation de sources distingue des
  timbres, pas des exécutants. `htdemucs_6s` produit **une** piste guitare et **une**
  piste piano, et aucun modèle publié ne va au-delà de façon fiable.

  **Ce qui est proposé à la place** : une division par position stéréo et par
  registre. Efficace quand les deux guitares sont panoramisées de part et d'autre,
  inopérante quand elles sont au centre. Utile, mais à présenter comme tel — pas
  comme une séparation.

---

## 2026-09-18 — Le quota compte les morceaux créés, pas ceux conservés

**Décision.** Le compteur mensuel s'incrémente à la création d'un morceau et ne
se décrémente jamais. Supprimer un morceau ne rend pas son crédit.

**Pourquoi.** Ce qui coûte, c'est la séparation — quelques minutes de calcul —
pas les mégaoctets conservés. Un compteur qui suit le stockage se contourne en
supprimant chaque morceau après l'avoir écouté.

**Corollaire.** Redéposer un fichier déjà connu ne consomme rien : la
déduplication rend le résultat sans relancer le pipeline.

---

## 2026-09-18 — La limitation de débit laisse passer quand elle tombe en panne

**Décision.** Quand Redis ne répond pas, le compteur retombe sur une table locale
à l'instance, et une erreur du compteur lui-même laisse passer la requête.

**Pourquoi.** Le risque que la limitation écarte — des abus — est moins grave que
celui qu'elle créerait en échouant fermé : une panne de Redis fermerait le
service entier. Le repli local continue de protéger contre le cas le plus
courant, un seul client qui martèle une seule instance.

**Limite assumée.** En plusieurs instances, le repli divise la limite effective
par le nombre de machines. C'est le prix d'un mode dégradé, et il est visible
dans les journaux.

---

## 2026-09-18 — CSP nominative, et `blob:` concédé à `script-src`

**Décision.** Politique de contenu par `nonce`, sans `'unsafe-inline'` sur les
scripts en production. `blob:` est ajouté à `script-src`.

**Pourquoi la concession.** `signalsmith-stretch` compile son AudioWorklet à la
volée et le charge depuis un blob ; un module d'AudioWorklet relève de
`script-src`, pas de `worker-src`. L'alternative — servir le module depuis un
fichier statique — demanderait d'extraire le code interne de la bibliothèque et
de le maintenir à chaque mise à jour.

**Portée réelle du risque.** Seul du script déjà exécuté sur l'origine peut
fabriquer un blob. La directive n'ouvre donc pas de porte nouvelle : elle laisse
passer ce qu'un attaquant ayant déjà l'exécution pourrait faire autrement.

**En développement**, la politique renonce au nonce : un navigateur ignore
`'unsafe-inline'` dès qu'un nonce est présent, et Vite injecte ses scripts en
ligne.

---

## 2026-09-18 — La sauvegarde est coupée en deux

**Problème.** `pg_dump` n'est pas disponible sur ce poste et n'y est pas
installable sans sudo — quatre approches distinctes ont échoué, la dernière sur
une cascade de bibliothèques partagées.

**Décision.** Le script shell produit le dump ; un script Node séparé le dépose et
applique la rétention, en lisant l'entrée standard.

**Pourquoi ce découpage.** Il ne s'agit pas de contourner la contrainte mais de
la cerner : la partie où une erreur détruit des données — le dépôt et la
rétention — se vérifie avec n'importe quels octets, et elle a été exécutée pour
de bon. Ce qui reste non vérifié est réduit à l'invocation d'un outil standard,
et cette limite est consignée dans `PROGRESS.md`.

**Garde-fou.** La rétention ne supprime jamais la dernière sauvegarde : sinon une
panne de sauvegarde prolongée deviendrait une perte de sauvegarde.

---

## 2026-09-18 — Chercher les valeurs des secrets, pas leurs noms

**Constat.** Un vérificateur qui cherche les _noms_ de variables signale
immédiatement `BETTER_AUTH_SECRET` : better-auth embarque un accesseur
d'environnement qui les cite tous, sans jamais porter de valeur. Un faux positif
permanent rend le contrôle inutile — on finit par l'ignorer.

**Décision.** Le contrôle cherche les **valeurs** des secrets, plus quelques
chaînes propres à nos modules serveur (les messages de validation d'`env.server.ts`).
Validé par contrôle négatif avant d'être ajouté à l'intégration continue.

---

## 2026-09-18 — La limite de débit s'applique avant la validation

**Décision.** Dans les routes qui valident un identifiant d'URL, `enforce()` est
appelé **avant** l'analyse du paramètre.

**Pourquoi.** L'ordre inverse laisse un attaquant marteler la route avec des
identifiants malformés sans jamais toucher le compteur : le refus arrive plus
tôt, mais il ne coûte rien à celui qui le provoque.

---

## 2026-09-18 — La transcription porte sur la voix isolée

**Décision.** Whisper reçoit le stem `vocals`, pas le mixage. La transcription
s'insère donc entre la séparation et l'encodage.

**Pourquoi.** C'est le seul avantage structurel de cette application sur un
transcripteur générique : le modèle n'a plus à démêler ce qui est parole de ce qui
ne l'est pas. Le coût est nul — la séparation a lieu de toute façon.

**Détail.** Le fichier confié au modèle est un WAV temporaire, pas l'Opus final :
Whisper rééchantillonne en 16 kHz, et passer par un format avec perte
n'apporterait rien.

---

## 2026-09-18 — NLLB-200 est écarté, OPUS-MT retenu

**Problème de licence.** `facebook/nllb-200-*` est publié sous CC-BY-NC : usage
non commercial. C'est exactement la contrainte qui avait fait écarter madmom.

**Décision.** Les modèles OPUS-MT de Helsinki-NLP, un par direction
(`opus-mt-en-fr`, `opus-mt-fr-en`). Petits, rapides, licences permissives.

**Limite assumée.** Un modèle par paire de langues : étendre au-delà du français
et de l'anglais demandera d'en ajouter d'autres, ou de reconsidérer un modèle
multilingue à licence acceptable — M2M-100 (MIT) est le candidat naturel.

---

## 2026-09-18 — La traduction est faite ligne à ligne

**Décision.** Chaque ligne transcrite est traduite séparément, et la traduction
est stockée comme une liste parallèle à celle des lignes.

**Pourquoi.** L'alignement avec les horodatages tient **entièrement** à la
correspondance de position. Traduire le texte entier puis le redécouper ne le
garantirait pas : rien n'oblige une traduction à conserver le nombre de phrases.

**Coût accepté.** Le modèle voit moins de contexte, donc quelques tournures moins
heureuses. C'est le bon échange quand l'affichage doit défiler en mesure.

**Garde-fou.** Une traduction dont la longueur ne correspond pas au nombre de
lignes n'est pas proposée à l'affichage.

---

## 2026-09-18 — Une transcription qui échoue n'emporte pas la séparation

**Décision.** Les erreurs de transcription et de traduction sont journalisées et
avalées ; le pipeline rend ses pistes et son analyse.

**Pourquoi.** Les pistes séparées sont l'essentiel du service, et elles sont déjà
produites quand la transcription commence. Faire échouer le job entier pour une
transcription manquée reviendrait à jeter le travail utile.

**Corollaire.** Un morceau instrumental rend `null`, pas une liste vide : un
résultat vide serait indistinguable d'un échec. Et un retraitement sans paroles
efface celles de la version précédente, plutôt que de les laisser derrière.

---

## 2026-09-18 — Le pad synthétise ses timbres plutôt que de charger des échantillons

**Décision.** Les huit voix du pad sont des empilements de partiels synthétisés,
et la réverbération une réponse impulsionnelle générée.

**Pourquoi.** Une nappe tenue est précisément ce que la synthèse additive rend le
mieux. Des échantillons apporteraient un réalisme que personne ne perçoit sous
une nappe, en échange de plusieurs dizaines de mégaoctets à télécharger — et d'un
pad inutilisable hors connexion tant qu'ils ne le sont pas.

**Conséquence utile.** Les voix sont des **données**. En ajouter une, ou corriger
un timbre à l'oreille, ne demande pas de toucher au moteur.

---

## 2026-09-18 — Un accord par groupe d'oscillateurs

**Décision.** Chaque accord joué crée son propre groupe d'oscillateurs, détruit
une fois sa descente terminée. Rien n'est réutilisé d'un accord au suivant.

**Pourquoi.** La continuité est tout l'objet d'une nappe : le nouvel accord doit
monter pendant que l'ancien descend. Réutiliser les oscillateurs en changeant
leur fréquence produirait un glissando — un effet, pas un fondu.

**Coût accepté.** Quelques dizaines d'oscillateurs vivent simultanément pendant le
recouvrement. C'est sans effet mesurable : ce sont des oscillateurs, pas des
décodeurs.

---

## 2026-09-18 — La grille du pad est diatonique, pas chromatique

**Décision.** Le pad propose les accords de la tonalité choisie — sept degrés plus
un emprunt — et non les douze fondamentales.

**Pourquoi.** Un pad se joue sans regarder, pendant qu'on fait autre chose.
Chercher un accord dans une grille de douze est exactement ce qu'il faut éviter ;
une grille diatonique se lit sans y penser.

**L'emprunt retenu.** En majeur, le `bVII` — omniprésent dans le répertoire de
louange, là où le `vii°` n'est jamais joué. En mineur, le `V` majeur, aux côtés du
`v` naturel : c'est lui qui résout, mais les deux restent offerts.

**Limite assumée.** Les accords hors tonalité — emprunts plus rares, dominantes
secondaires — ne sont pas accessibles. Changer de tonalité reste possible d'un
clic ; au-delà, ce serait un autre instrument.

---

## 2026-09-18 — Trois sources pour le pad, et ce que chacune implique

**Constat.** Les nappes de louange vendues dans le commerce sont des **fichiers
audio produits en studio, un par tonalité** — pas des synthétiseurs. Aucune
synthèse dans un navigateur ne les égalera : la valeur est dans l'enregistrement.

**Décision.** Trois sources coexistent, chacune assumée pour ce qu'elle est.

| Source       | Ce qu'elle apporte                    | Ce qu'elle coûte                          |
| ------------ | ------------------------------------- | ----------------------------------------- |
| Synthèse     | rien à télécharger, marche hors ligne | ne sonnera jamais comme un enregistrement |
| Échantillons | le grain d'instruments réels          | 24 Mo au premier usage ; nappes GM datées |
| Vos nappes   | exactement le son voulu               | il faut posséder les fichiers             |

**Corollaire assumé.** Une nappe enregistrée couvre une tonalité entière, pas un
accord. Le modèle d'interaction diffère donc des deux autres sources, et
l'interface l'énonce plutôt que de laisser croire à un défaut.

---

## 2026-09-18 — Aucun effet sur les nappes importées

**Décision.** La chaîne de réverbération et d'écho est contournée pour la source
« Mes nappes ». Les réglages qui n'ont pas de prise sont masqués ou désactivés.

**Pourquoi.** Ces fichiers sortent d'un studio, réverbération comprise. Leur en
superposer une seconde ne les améliorerait pas, elle les embrouillerait. Et un
réglage qui bouge sans rien changer est pire qu'un réglage absent : il fait douter
de tout le reste.

---

## 2026-09-18 — La tonalité se lit par jetons, pas par recherche de lettre

**Constat.** Chercher une note n'importe où dans un nom de fichier lit `A` dans
« Ambient », `D` dans « Dwell » et `G` dans « Grandiose ». Les noms de
bibliothèques en sont pleins.

**Décision.** Le nom est découpé en jetons, et seul un jeton qui **est** une
tonalité est reconnu : `C`, `F#`, `Bbm`, `Amaj`, ou une note suivie de
`major`/`minor`. En l'absence de mode, le majeur est choisi — beaucoup de
bibliothèques ne le précisent pas, une nappe tenue étant souvent jouable dans les
deux.

**Garde-fou.** La tonalité devinée reste modifiable : elle fait gagner vingt-quatre
réglages, elle n'engage rien.
