#!/usr/bin/env bash
#
# Deploy peonyy-music to remote server.
#
# First time:
#   1. cp scripts/deploy.config.example scripts/deploy.config.sh
#   2. Edit scripts/deploy.config.sh (host, path, etc.)
#   3. Set up SSH key: ssh-copy-id root@62.238.60.92
#      Or use SSHPASS in deploy.config.sh (requires sshpass)
#   4. Copy .env to server: ./scripts/deploy.sh push-env
#   5. Bootstrap server:       ./scripts/deploy.sh setup-server
#   6. Deploy:                 ./scripts/deploy.sh
#
# Usage:
#   ./scripts/deploy.sh              # full deploy
#   ./scripts/deploy.sh push-env     # upload .env only
#   ./scripts/deploy.sh setup-server # install Node/Yarn/PM2 on server
#   ./scripts/deploy.sh logs         # tail PM2 logs
#   ./scripts/deploy.sh status       # PM2 status

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="$ROOT_DIR/scripts/deploy.config.sh"

if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
fi

DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_HOST="${DEPLOY_HOST:-62.238.60.92}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/peonyy-music}"
APP_NAME="${APP_NAME:-peonyy-music}"
APP_PORT="${APP_PORT:-4000}"
SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"

RSYNC_EXCLUDES=(
  --exclude '.git'
  --exclude 'node_modules'
  --exclude 'dist'
  --exclude '.env'
  --exclude '.env.*'
  --exclude 'coverage'
  --exclude 'mezon-cache'
  --exclude 'storage'
  --exclude 'scripts/deploy.config.sh'
)

ssh_cmd() {
  if [[ -n "${SSHPASS:-}" ]] && command -v sshpass >/dev/null 2>&1; then
    sshpass -e ssh -o StrictHostKeyChecking=accept-new "$SSH_TARGET" "$@"
  else
    ssh -o StrictHostKeyChecking=accept-new "$SSH_TARGET" "$@"
  fi
}

rsync_cmd() {
  local -a opts=(-avz --delete "${RSYNC_EXCLUDES[@]}" "$@")
  if [[ -n "${SSHPASS:-}" ]] && command -v sshpass >/dev/null 2>&1; then
    sshpass -e rsync "${opts[@]}" -e "ssh -o StrictHostKeyChecking=accept-new"
  else
    rsync "${opts[@]}" -e "ssh -o StrictHostKeyChecking=accept-new"
  fi
}

remote_setup_server() {
  echo "==> Running server bootstrap on $SSH_TARGET ..."
  ssh_cmd "DEPLOY_PATH='$DEPLOY_PATH' APP_NAME='$APP_NAME' APP_PORT='$APP_PORT' bash -s" \
    < "$ROOT_DIR/scripts/setup-server.sh"
}

remote_push_env() {
  local env_file="$ROOT_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    echo "Error: $env_file not found. Create it from .env.example first."
    exit 1
  fi
  echo "==> Uploading .env to $SSH_TARGET:$DEPLOY_PATH/.env ..."
  ssh_cmd "mkdir -p '$DEPLOY_PATH'"
  if [[ -n "${SSHPASS:-}" ]] && command -v sshpass >/dev/null 2>&1; then
    sshpass -e scp -o StrictHostKeyChecking=accept-new "$env_file" "$SSH_TARGET:$DEPLOY_PATH/.env"
  else
    scp -o StrictHostKeyChecking=accept-new "$env_file" "$SSH_TARGET:$DEPLOY_PATH/.env"
  fi
  echo "==> .env uploaded."
}

remote_deploy() {
  echo "==> Syncing source to $SSH_TARGET:$DEPLOY_PATH ..."
  ssh_cmd "mkdir -p '$DEPLOY_PATH'"
  rsync_cmd "$ROOT_DIR/" "$SSH_TARGET:$DEPLOY_PATH/"

  echo "==> Building and restarting on server ..."
  ssh_cmd "bash -s" <<REMOTE
set -euo pipefail
cd '$DEPLOY_PATH'

export NODE_ENV=production
export PORT='$APP_PORT'

if [[ ! -f .env ]]; then
  echo "Error: .env missing on server. Run: ./scripts/deploy.sh push-env"
  exit 1
fi

corepack enable
corepack prepare yarn@4.15.0 --activate

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "--> installing ffmpeg"
  apt-get update -qq && apt-get install -y -qq ffmpeg
fi

echo "--> yarn install"
yarn install --immutable 2>/dev/null || yarn install

echo "--> prisma generate"
yarn db:gen

echo "--> prisma migrate deploy"
npx prisma migrate deploy

echo "--> build"
yarn build

ENTRY="dist/src/main.js"
if [[ ! -f "\$ENTRY" ]]; then
  echo "Error: build output not found at \$ENTRY"
  ls -la dist/ 2>/dev/null || true
  exit 1
fi

echo "--> pm2 restart"
if pm2 describe '$APP_NAME' >/dev/null 2>&1; then
  pm2 delete '$APP_NAME'
fi
pm2 start "\$ENTRY" --name '$APP_NAME' --cwd '$DEPLOY_PATH'
pm2 save

pm2 status '$APP_NAME'
REMOTE

  echo ""
  echo "==> Deploy finished. App: http://$DEPLOY_HOST:$APP_PORT"
}

remote_logs() {
  ssh_cmd "pm2 logs '$APP_NAME' --lines 100"
}

remote_status() {
  ssh_cmd "pm2 status '$APP_NAME' && pm2 describe '$APP_NAME'"
}

usage() {
  sed -n '2,20p' "$0" | tail -n +2
  exit "${1:-0}"
}

main() {
  local action="${1:-deploy}"

  case "$action" in
    deploy)
      remote_deploy
      ;;
    push-env)
      remote_push_env
      ;;
    setup-server)
      remote_setup_server
      ;;
    logs)
      remote_logs
      ;;
    status)
      remote_status
      ;;
    -h|--help|help)
      usage 0
      ;;
    *)
      echo "Unknown command: $action"
      usage 1
      ;;
  esac
}

main "$@"
