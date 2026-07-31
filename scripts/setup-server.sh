#!/usr/bin/env bash
# One-time server bootstrap. Run ON the server as root:
#   curl -fsSL ... | bash
# Or from local machine:
#   ./scripts/deploy.sh setup-server

set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/peonyy-music}"
APP_NAME="${APP_NAME:-peonyy-music}"
APP_PORT="${APP_PORT:-4000}"

echo "==> Installing system dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg rsync ffmpeg

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

echo "==> Node $(node -v), npm $(npm -v)"

corepack enable
corepack prepare yarn@4.15.0 --activate

if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Installing PM2..."
  npm install -g pm2
fi

mkdir -p "$DEPLOY_PATH"
chown -R "${SUDO_USER:-root}:${SUDO_USER:-root}" "$DEPLOY_PATH" 2>/dev/null || true

echo "==> Server ready."
echo "    Deploy path: $DEPLOY_PATH"
echo "    Next: copy .env to $DEPLOY_PATH/.env then run ./scripts/deploy.sh from your machine"
