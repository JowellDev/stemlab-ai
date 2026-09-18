# Revenir en arrière

Trois situations, trois procédures. La différence tient entièrement à ce que la
migration a fait au schéma.

## 1. Le code seul est en cause — la migration est additive

C'est le cas courant, et le seul qui soit réellement simple.
`node scripts/check-migrations.mjs` l'a confirmé avant le déploiement : l'ancien
code fonctionne avec le nouveau schéma, puisque rien n'a été retiré.

```bash
flyctl releases --app stemlab-web            # repérer la version précédente
flyctl releases rollback <version> --app stemlab-web
curl -fsS https://<domaine>/health           # vérifier
```

Le schéma reste en avance sur le code. C'est sans conséquence : une colonne
inutilisée ne gêne personne, et le prochain déploiement la retrouvera.

## 2. La migration est destructive

`check-migrations.mjs` l'a signalé. Un retour du code **ne suffit pas** : la
colonne supprimée a emporté ses données, et l'ancien code la cherchera en vain.

1. Restaurer la dernière sauvegarde antérieure au déploiement :

   ```bash
   node scripts/backup-store.mjs --list
   # récupérer l'objet, puis
   gunzip -c sauvegarde.sql.gz | psql "$DATABASE_URL"
   ```

2. Revenir au code (procédure 1).
3. Les écritures survenues entre la sauvegarde et la restauration sont perdues.
   C'est le coût réel d'une migration destructive, et la raison de la règle
   ci-dessous.

**La règle.** Ne jamais retirer dans la version qui cesse d'utiliser. Une version
ajoute et écrit dans les deux endroits ; une version ultérieure, une fois la
précédente hors service, retire. Le déploiement reste alors réversible à chaque
étape.

## 3. Le worker GPU

Modal conserve les versions déployées :

```bash
modal app history stemlab-worker
modal app rollback stemlab-worker --version <n>
```

Aucun trafic à basculer : le worker consomme une file. Les jobs en cours au
moment du retour arrière vont jusqu'au bout sur l'ancien conteneur, ceux qui
échouent sont remis en file — trois essais, puis la file de rebut.

## Avant chaque déploiement

```bash
pnpm preflight              # la configuration est complète et sans valeur d'exemple
node scripts/check-migrations.mjs   # le retour arrière reste possible
```

## Ce qui n'a pas été éprouvé

**Aucune de ces procédures n'a été exécutée** : il n'existe ni compte Fly.io, ni
compte Modal, ni base de production dans cet environnement. Les commandes sont
celles de la documentation de chaque outil ; les scripts du dépôt qu'elles
appellent, eux, ont été exécutés.

La restauration d'une sauvegarde en particulier — `gunzip | psql` — n'a pas pu
être vérifiée, faute de client PostgreSQL installable ici (voir `DECISIONS.md`).
À dérouler une fois en entier, sur un environnement de recette, avant la première
mise en production réelle.
