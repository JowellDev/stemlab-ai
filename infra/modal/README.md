# Worker GPU (Modal)

Le GPU ne tourne **que** pendant un traitement. Modal démarre un conteneur à
l'arrivée d'un job et l'éteint après une minute d'inactivité : aucune instance
GPU n'est allumée à vide.

| Réglage             | Valeur | Pourquoi                                                                  |
| ------------------- | ------ | ------------------------------------------------------------------------- |
| `gpu`               | L4     | 24 Go de VRAM, assez pour Demucs et Whisper `large-v3`, moins chère qu'A10G |
| `timeout`           | 600 s  | dix minutes ; au-delà, quelque chose est bloqué et il vaut mieux rendre la main |
| `scaledown_window`  | 60 s   | assez pour enchaîner une file, trop court pour coûter à vide              |
| `min_containers`    | 0      | **la contrainte de coût** : jamais d'instance allumée sans travail        |
| `max_containers`    | 4      | borne la facture en cas d'afflux                                          |

## Volume de modèles

Demucs et Whisper pèsent plusieurs gigaoctets. Sans volume persistant, chaque
démarrage à froid les retéléchargerait — une bonne minute avant le premier
échantillon traité. Le volume est *commit* à la fin de chaque traitement, donc
les modèles servent aux conteneurs suivants.

## Déploiement

```bash
modal secret create stemlab \
  ML_WEBHOOK_SECRET=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… \
  S3_BUCKET=… S3_ENDPOINT=… WHISPER_MODEL=large-v3

modal deploy infra/modal/worker.py
```

## Ce qui reste à vérifier

Ce fichier **n'a pas été exécuté** : il n'y a ni compte Modal ni GPU dans
l'environnement de développement. Le pipeline qu'il invoque, lui, est le même que
celui vérifié en intégration continue sur processeur — c'est la frontière avec
Modal qui n'est pas éprouvée, pas le traitement.
