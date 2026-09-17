#!/usr/bin/env bash
# =============================================================================
# Services de developpement STEMLAB sans Docker.
#
# Demarre Postgres, Redis et un stockage S3-compatible en userspace, sur les
# memes ports que `infra/docker-compose.yml`. Les binaires sont telecharges
# une fois dans .devservices/ (ignore par git).
#
#   pnpm services start | stop | status | reset | logs <service>
#
# Utiliser docker compose quand Docker est disponible ; ce script est le repli
# pour un poste ou Docker Desktop n'est pas integre a WSL.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV="$ROOT/.devservices"
BIN="$DEV/bin"
DATA="$DEV/data"
LOGS="$DEV/logs"
RUN="$DEV/run"

PG_VERSION="17.2.0"
REDIS_VERSION="8.0.3"
WEED_VERSION="4.47"

PG_PORT=55432
REDIS_PORT=56379
S3_PORT=59000

PG_USER=stemlab
PG_PASSWORD=stemlab
PG_DB=stemlab
S3_ACCESS_KEY=stemlab-dev
S3_SECRET_KEY=stemlab-dev-secret
S3_BUCKET=stemlab

log() { printf '\033[36m[services]\033[0m %s\n' "$*"; }
err() { printf '\033[31m[services]\033[0m %s\n' "$*" >&2; }

require() {
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || { err "commande requise absente : $cmd"; exit 1; }
  done
}

port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && exec 3<&- && return 0 || return 1; }

wait_for_port_closed() {
  local port=$1 tries=${2:-40}
  for _ in $(seq 1 "$tries"); do
    port_busy "$port" || return 0
    sleep 0.25
  done
  return 1
}

wait_for_port() {
  local port=$1 name=$2 tries=${3:-60}
  for _ in $(seq 1 "$tries"); do
    port_busy "$port" && return 0
    sleep 0.5
  done
  err "$name n'ecoute toujours pas sur le port $port — voir $LOGS/$name.log"
  return 1
}

# --- installation ------------------------------------------------------------

install_postgres() {
  [ -x "$BIN/postgres/bin/postgres" ] && return 0
  require curl unzip tar
  log "telechargement de Postgres $PG_VERSION (binaires zonky, sans root)"
  local jar="$DEV/cache/postgres.jar"
  mkdir -p "$DEV/cache" "$BIN/postgres"
  curl -fsSL -o "$jar" \
    "https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-linux-amd64/${PG_VERSION}/embedded-postgres-binaries-linux-amd64-${PG_VERSION}.jar"
  rm -rf "$DEV/cache/pgjar" && mkdir -p "$DEV/cache/pgjar"
  unzip -qo "$jar" -d "$DEV/cache/pgjar"
  local txz
  txz="$(find "$DEV/cache/pgjar" -name '*.txz' -print -quit)"
  [ -n "$txz" ] || { err "archive postgres introuvable dans le jar"; exit 1; }
  tar -xJf "$txz" -C "$BIN/postgres"
  log "postgres installe dans $BIN/postgres"
}

install_redis() {
  [ -x "$BIN/redis-server" ] && return 0
  require curl tar make gcc
  log "compilation de Redis $REDIS_VERSION (aucun binaire officiel sans root)"
  mkdir -p "$DEV/cache" "$BIN"
  local src="$DEV/cache/redis-$REDIS_VERSION"
  if [ ! -d "$src" ]; then
    curl -fsSL "https://download.redis.io/releases/redis-${REDIS_VERSION}.tar.gz" \
      | tar -xz -C "$DEV/cache"
  fi
  make -C "$src" -j"$(nproc)" MALLOC=libc BUILD_TLS=no >"$DEV/cache/redis-build.log" 2>&1 \
    || { err "echec de compilation de redis — voir $DEV/cache/redis-build.log"; exit 1; }
  cp "$src/src/redis-server" "$src/src/redis-cli" "$BIN/"
  log "redis installe dans $BIN"
}

install_weed() {
  [ -x "$BIN/weed" ] && return 0
  require curl tar
  log "telechargement de SeaweedFS $WEED_VERSION (passerelle S3)"
  mkdir -p "$DEV/cache" "$BIN"
  curl -fsSL "https://github.com/seaweedfs/seaweedfs/releases/download/${WEED_VERSION}/linux_amd64.tar.gz" \
    | tar -xz -C "$BIN"
  chmod +x "$BIN/weed"
  log "seaweedfs installe dans $BIN"
}

# --- demarrage ---------------------------------------------------------------

start_postgres() {
  if port_busy "$PG_PORT"; then
    log "postgres deja en ecoute sur $PG_PORT"
  else
    start_postgres_process
  fi
  ensure_database
}

ensure_database() {
  PGHOST=127.0.0.1 PGPORT="$PG_PORT" PGUSER="$PG_USER" PGPASSWORD="$PG_PASSWORD" \
    node "$ROOT/scripts/ensure-db.mjs" "$PG_DB"
  log "postgres pret sur postgresql://$PG_USER:***@localhost:$PG_PORT/$PG_DB"
}

start_postgres_process() {
  install_postgres
  local pgdata="$DATA/postgres"
  if [ ! -f "$pgdata/PG_VERSION" ]; then
    log "initialisation du cluster postgres"
    mkdir -p "$pgdata"
    printf '%s' "$PG_PASSWORD" > "$DEV/run/pgpass.tmp"
    "$BIN/postgres/bin/initdb" -D "$pgdata" -U "$PG_USER" --auth=scram-sha-256 \
      --pwfile="$DEV/run/pgpass.tmp" --encoding=UTF8 --locale=C >"$LOGS/postgres-init.log" 2>&1
    rm -f "$DEV/run/pgpass.tmp"
  fi
  "$BIN/postgres/bin/pg_ctl" -D "$pgdata" -l "$LOGS/postgres.log" \
    -o "-p $PG_PORT -k $RUN -c listen_addresses=127.0.0.1" start >/dev/null
  wait_for_port "$PG_PORT" postgres
}

start_redis() {
  if port_busy "$REDIS_PORT"; then log "redis deja en ecoute sur $REDIS_PORT"; return 0; fi
  install_redis
  mkdir -p "$DATA/redis"
  "$BIN/redis-server" --port "$REDIS_PORT" --bind 127.0.0.1 --daemonize yes \
    --dir "$DATA/redis" --appendonly yes --pidfile "$RUN/redis.pid" \
    --logfile "$LOGS/redis.log"
  wait_for_port "$REDIS_PORT" redis
  log "redis pret sur redis://localhost:$REDIS_PORT"
}

start_s3() {
  if port_busy "$S3_PORT"; then
    log "s3 deja en ecoute sur $S3_PORT"
  else
    start_s3_process
  fi
  ensure_bucket
  log "s3 pret sur http://localhost:$S3_PORT (bucket $S3_BUCKET)"
}

ensure_bucket() {
  local attempt
  # La passerelle S3 accepte les connexions un court instant apres l'ouverture du
  # port : on retente en silence, et on n'affiche l'erreur qu'au dernier essai.
  for attempt in $(seq 1 30); do
    if [ "$attempt" = "30" ]; then
      S3_ENDPOINT="http://127.0.0.1:$S3_PORT" S3_BUCKET="$S3_BUCKET" \
        S3_ACCESS_KEY_ID="$S3_ACCESS_KEY" S3_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
        node "$ROOT/scripts/ensure-bucket.mjs" && return 0
      err "impossible de creer le bucket $S3_BUCKET"
      return 1
    fi
    if S3_ENDPOINT="http://127.0.0.1:$S3_PORT" S3_BUCKET="$S3_BUCKET" \
       S3_ACCESS_KEY_ID="$S3_ACCESS_KEY" S3_SECRET_ACCESS_KEY="$S3_SECRET_KEY" \
       node "$ROOT/scripts/ensure-bucket.mjs" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
}

start_s3_process() {
  install_weed
  mkdir -p "$DATA/s3"
  cat > "$DEV/run/s3.json" <<JSON
{
  "identities": [
    {
      "name": "$S3_ACCESS_KEY",
      "credentials": [{ "accessKey": "$S3_ACCESS_KEY", "secretKey": "$S3_SECRET_KEY" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
JSON
  # Par defaut weed derive le port gRPC en `port + 10000`, ce qui depasse 65535
  # avec nos ports 59xxx : on les fixe donc explicitement.
  nohup "$BIN/weed" server -dir="$DATA/s3" -ip=127.0.0.1 \
    -s3 -s3.port="$S3_PORT" -s3.port.grpc=49000 -s3.config="$DEV/run/s3.json" \
    -master.port=59333 -master.port.grpc=49333 \
    -volume.port=59080 -volume.port.grpc=49080 \
    -filer.port=59888 -filer.port.grpc=49888 \
    -master.telemetry=false \
    >"$LOGS/s3.log" 2>&1 &
  echo $! > "$RUN/s3.pid"
  wait_for_port "$S3_PORT" s3 120
}

# --- arret -------------------------------------------------------------------

stop_all() {
  if [ -f "$DATA/postgres/PG_VERSION" ] && [ -x "$BIN/postgres/bin/pg_ctl" ]; then
    "$BIN/postgres/bin/pg_ctl" -D "$DATA/postgres" -m fast stop >/dev/null 2>&1 \
      && log "postgres arrete" || true
  fi
  if [ -x "$BIN/redis-cli" ] && port_busy "$REDIS_PORT"; then
    "$BIN/redis-cli" -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1 || true
    log "redis arrete"
  fi
  if [ -f "$RUN/s3.pid" ]; then
    local pid
    pid="$(cat "$RUN/s3.pid")"
    kill "$pid" 2>/dev/null || true
    # weed prend quelques secondes a rendre ses ports : on attend la fermeture
    # effective, sinon un `start` immediat croit le service deja en place.
    wait_for_port_closed "$S3_PORT" || { kill -9 "$pid" 2>/dev/null || true; }
    wait_for_port_closed "$S3_PORT" || err "le port $S3_PORT reste occupe"
    rm -f "$RUN/s3.pid"
    log "s3 arrete"
  fi
}

status_all() {
  printf '%-10s %-8s %s\n' SERVICE PORT ETAT
  for entry in "postgres $PG_PORT" "redis $REDIS_PORT" "s3 $S3_PORT"; do
    set -- $entry
    if port_busy "$2"; then
      printf '%-10s %-8s \033[32men ecoute\033[0m\n' "$1" "$2"
    else
      printf '%-10s %-8s \033[31marrete\033[0m\n' "$1" "$2"
    fi
  done
}

reset_all() {
  stop_all
  rm -rf "$DATA"
  log "donnees supprimees (les binaires telecharges sont conserves)"
}

mkdir -p "$BIN" "$DATA" "$LOGS" "$RUN" "$DEV/cache"

case "${1:-start}" in
  start)
    start_postgres
    start_redis
    start_s3
    echo
    status_all
    ;;
  stop) stop_all ;;
  status) status_all ;;
  reset) reset_all ;;
  logs) tail -f "$LOGS/${2:-postgres}.log" ;;
  *)
    err "usage : pnpm services [start|stop|status|reset|logs <service>]"
    exit 1
    ;;
esac
