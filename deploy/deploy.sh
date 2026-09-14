#!/usr/bin/env bash
# Deploy the latest master onto this EC2 host.
#   ./deploy/deploy.sh [all|ui|api]    (default: all)
# One-time host setup: see DEPLOYMENT.md, "EC2 + Caddy behind CloudFront".
set -euo pipefail

# Everything runs inside main() so bash has parsed the whole script before `git pull` rewrites it.
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
  git -C "$repo" log --oneline -1

  if [[ "$target" == all || "$target" == ui ]]; then
    echo ">> Building frontend (inside node:20-alpine; no Node needed on the host)"
    [[ -f "$repo/.env.production" ]] || cp "$repo/.env.production.example" "$repo/.env.production"
    docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp \
      -v "$repo":/app -w /app node:20-alpine \
      sh -c "npm ci --no-audit --no-fund && npm run build"
  fi

  cd "$deploy_dir"
  if [[ "$target" == all || "$target" == api ]]; then
    echo ">> Rebuilding API image"
    docker compose build api
  fi

  echo ">> Starting / updating containers"
  docker compose up -d

  echo ">> Reloading Caddy config"
  local i
  for i in $(seq 1 10); do
    # A just-recreated Caddy needs a moment before its admin endpoint accepts a reload.
    if docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
      break
    fi
    if [[ $i == 10 ]]; then
      echo "!! Caddy reload failed" >&2
      exit 1
    fi
    sleep 2
  done

  echo ">> Waiting for the API (model load takes about a minute after a rebuild)"
  for i in $(seq 1 60); do
    if curl -fsS http://localhost/health; then
      echo
      break
    fi
    if [[ $i == 60 ]]; then
      echo "!! API not healthy after 3 minutes" >&2
      docker compose logs --tail 50 api
      exit 1
    fi
    sleep 3
  done

  echo ">> Deployed. Public check: https://shubhkamnauat.narendramodi.in/health"
}

main "$@"
exit
