#!/usr/bin/env bash
# Replace the api container without downtime:
#   1. start a new container next to the running one (docker compose --scale api=N+1),
#   2. wait until its /health answers (loading the model takes about a minute),
#   3. stop the old one.
# Caddy resolves every api container and retries a refused connection on another, so requests keep
# flowing throughout. If the new container never becomes healthy it is removed and the old one keeps
# serving. Called by deploy.sh after `docker compose build api`; safe to run on its own.
set -euo pipefail

HEALTH_TIMEOUT_SECONDS="${ROLLOUT_HEALTH_TIMEOUT:-300}"
# Two api containers each hold the model in memory; below this much free RAM, restart in place.
MIN_FREE_MB="${ROLLOUT_MIN_FREE_MB:-2500}"

main() {
  cd "$(dirname "${BASH_SOURCE[0]}")"

  local old
  old="$(docker compose ps -q api)"
  if [[ -z "$old" ]]; then
    echo ">> No API container running; starting one"
    docker compose up -d --no-deps api
    wait_healthy "$(docker compose ps -q api)"
    return
  fi

  local free_mb
  free_mb="$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo 2>/dev/null || echo 0)"
  if ((free_mb < MIN_FREE_MB)); then
    echo "!! Only ${free_mb} MB RAM free (need ${MIN_FREE_MB}); restarting the API in place (about a minute of errors)"
    docker compose up -d --no-deps api
    wait_healthy "$(docker compose ps -q api | head -1)"
    return
  fi

  echo ">> Starting a new API container next to the running one"
  docker compose up -d --no-deps --no-recreate --scale "api=$(($(wc -l <<<"$old") + 1))" api
  local new
  new="$(comm -13 <(sort <<<"$old") <(docker compose ps -q api | sort))"
  if [[ -z "$new" ]]; then
    echo "!! docker compose did not start a new API container" >&2
    exit 1
  fi

  if [[ "$(signature "$new")" == "$(signature "$(head -1 <<<"$old")")" ]]; then
    echo ">> API image and config unchanged; keeping the running container"
    docker rm -f "$new" >/dev/null
    return
  fi

  if ! wait_healthy "$new"; then
    docker rm -f "$new" >/dev/null
    echo "!! Rollout aborted; the previous API container is still serving" >&2
    exit 1
  fi

  echo ">> New API is healthy; retiring the old container"
  # SIGTERM lets uvicorn finish in-flight requests; new ones are retried on the new container.
  # $old is deliberately unquoted: it can hold several ids after an interrupted rollout.
  # shellcheck disable=SC2086
  docker stop -t 30 $old >/dev/null
  # shellcheck disable=SC2086
  docker rm $old >/dev/null
  echo ">> API rollout complete"
}

# Image id plus compose's config hash: equal means the new container would run exactly the same thing.
signature() {
  docker inspect -f '{{.Image}} {{index .Config.Labels "com.docker.compose.config-hash"}}' "$1"
}

wait_healthy() {
  local cid="$1" deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS)) state ip
  printf '>> Waiting for the new API to load its model '
  while ((SECONDS < deadline)); do
    # restart: unless-stopped would hide a crash loop behind "running", so a restart counts as failure.
    state="$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$cid" 2>/dev/null || echo 'false 0')"
    if [[ "$state" != "true 0" ]]; then
      echo
      echo "!! The new API container crashed during startup:" >&2
      docker logs --tail 50 "$cid" >&2 || true
      return 1
    fi
    ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$cid")"
    # Probe from the caddy container: the API image has no curl and publishes no port.
    if [[ -n "$ip" ]] && docker compose exec -T caddy wget -q -O /dev/null -T 3 "http://$ip:8000/health" 2>/dev/null; then
      echo " ready"
      return 0
    fi
    printf '.'
    sleep 3
  done
  echo
  echo "!! The new API did not become healthy within ${HEALTH_TIMEOUT_SECONDS}s:" >&2
  docker logs --tail 50 "$cid" >&2 || true
  return 1
}

main "$@"
