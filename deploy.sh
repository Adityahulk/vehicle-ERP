#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────
# Vehicle ERP — Production deployment script
# Usage: ./deploy.sh
# ──────────────────────────────────────────────────────────

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$APP_DIR/logs"

echo "═══════════════════════════════════════════"
echo "  Vehicle ERP — Deploying..."
echo "  Dir: $APP_DIR"
echo "  Time: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════"

# Ensure logs directory exists
mkdir -p "$LOG_DIR"

# ── 1. Pull latest code ─────────────────────────────────
echo ""
echo "▶ [1/5] Pulling latest code..."
cd "$APP_DIR"
git pull --ff-only origin main

# ── 2. Install backend dependencies ─────────────────────
echo ""
echo "▶ [2/5] Installing backend dependencies..."
cd "$APP_DIR/backend"
npm ci --production --ignore-scripts

# ── 3. Install frontend deps & build ────────────────────
echo ""
echo "▶ [3/5] Building frontend..."
cd "$APP_DIR/frontend"
npm ci
npm run build

# ── 4. Run database migrations ──────────────────────────
echo ""
echo "▶ [4/5] Running database migrations..."
cd "$APP_DIR/backend"
node src/db/migrate.js

# ── 5. Reload PM2 (zero-downtime for cluster mode) ──────
echo ""
echo "▶ [5/5] Reloading PM2 processes..."
cd "$APP_DIR"

if pm2 describe vehicle-erp-api > /dev/null 2>&1; then
  pm2 reload ecosystem.config.js --env production
else
  pm2 start ecosystem.config.js --env production
fi

pm2 save

echo ""
echo "═══════════════════════════════════════════"
echo "  ✓ Deployment complete!"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════"
echo ""
pm2 status
