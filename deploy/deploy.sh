#!/usr/bin/env bash
# Deploy the latest master onto this EC2 host.
#   ./deploy/deploy.sh [all|ui|api]    (default: all)
# One-time host setup: see DEPLOYMENT.md, "EC2 + Caddy behind CloudFront".
set -euo pipefail

# Everything runs inside functions so bash has parsed the whole script before `git pull` rewrites it.
main() {
  local target="${1:-all}"
  case "$target" in
    all | ui | api) ;;
    *) echo "usage: $0 [all|ui|api]" >&2; exit 2 ;;
  esac

  local deploy_dir repo
  deploy_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo="$(dirname "$deploy_dir")"

  if [[ ! -f "$deploy_dir/api.env" ]]; then
    echo "!! $deploy_dir/api.env is missing: create it from server/.env.example (secrets; never commit it)." >&2
    exit 1
  fi

  echo ">> Pulling latest master"
  git -C "$repo" pull --ff-only origin master
  git -C "$repo" --no-pager log --oneline -1
  restore_missing_tracked_files "$repo"

  if [[ "$target" == all || "$target" == ui ]]; then
    echo ">> Building frontend (inside node:20-alpine; no Node needed on the host)"
    [[ -f "$repo/.env.production" ]] || cp "$repo/.env.production.example" "$repo/.env.production"
    docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp \
      -v "$repo":/app -w /app node:20-alpine \
      sh -c "npm ci --no-audit --no-fund && npm run build"
  fi

  cd "$deploy_dir"
  if [[ "$target" == all || "$target" == api ]]; then
    echo ">> Building API image"
    docker compose build api
  fi

  echo ">> Updating Caddy"
  docker compose up -d --no-deps caddy
  reload_caddy

  if [[ "$target" == all || "$target" == api || -z "$(docker compose ps -q api)" ]]; then
    "$deploy_dir/rollout-api.sh"
  fi

  echo ">> Checking /health through Caddy"
  local i
  for i in $(seq 1 20); do
    if curl -fsS http://localhost/health 2>/dev/null; then
      echo
      echo ">> Deployed. Public check: https://aishubhkamna.narendramodi.in/health"
      return 0
    fi
    sleep 3
  done
  echo "!! /health is not answering through Caddy" >&2
  docker compose ps >&2
  exit 1
}

# A tracked file deleted on the host (it happened to package-lock.json) survives `git pull --ff-only`
# when master did not touch it, and the build then fails. Deploys must build exactly master, so put
# any such file back. Untracked files (deploy/api.env, deploy/.env, dist/) are never affected.
restore_missing_tracked_files() {
  local repo="$1" missing
  missing="$(git -C "$repo" ls-files --deleted)"
  [[ -n "$missing" ]] || return 0
  echo ">> Restoring tracked files missing from the checkout:"
  echo "$missing" | sed 's/^/   /'
  git -C "$repo" ls-files --deleted -z | xargs -0 -r git -C "$repo" checkout --
}

reload_caddy() {
  local i
  for i in $(seq 1 10); do
    # A just-recreated Caddy needs a moment before its admin endpoint accepts a reload.
    if docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "!! Caddy reload failed:" >&2
  docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >&2
  exit 1
}

main "$@"
exit
