#!/usr/bin/env bash
# Sauvegarde quotidienne de PostgreSQL.
#
# Le dump n'est jamais ecrit sur disque : il traverse le tube jusqu'au stockage
# objet. Une machine de sauvegarde n'a pas forcement la place d'un dump complet,
# et un fichier temporaire oublie est une copie de la base en clair.
#
# `pipefail` est essentiel : sans lui, un `pg_dump` qui echoue laisserait passer
# un flux vide, et la sauvegarde serait declaree reussie.
set -euo pipefail

cd "$(dirname "$0")/.."

PG_DUMP="${PG_DUMP:-pg_dump}"
: "${DATABASE_URL:?DATABASE_URL est requis}"

if ! command -v "$PG_DUMP" >/dev/null 2>&1; then
  echo "pg_dump introuvable ($PG_DUMP). Definissez PG_DUMP sur son chemin." >&2
  exit 1
fi

echo "dump de la base…" >&2
"$PG_DUMP" "$DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --format=plain \
  | gzip -9 \
  | node scripts/backup-store.mjs
