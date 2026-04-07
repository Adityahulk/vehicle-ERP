#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════
# Vehicle ERP — DigitalOcean Docker Deployment
#
# This script does EVERYTHING on a fresh Ubuntu 22.04 droplet:
#   1. Installs Docker
#   2. Clones the repo
#   3. Gets SSL certificate
#   4. Starts everything with docker compose
#
# Usage:
#   ssh root@your-droplet-ip
#   curl -sL https://raw.githubusercontent.com/YOUR_USER/vehicle-erp/main/docker-deploy.sh | bash
#   — OR —
#   Copy this file to the server and run: bash docker-deploy.sh
# ═══════════════════════════════════════════════════════════════

# Auto-detect: if run from inside a git repo, use that directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -d "$SCRIPT_DIR/.git" ]; then
    APP_DIR="$SCRIPT_DIR"
else
    APP_DIR="/var/www/vehicle-erp"
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  Vehicle ERP — Docker Deployment"
echo "  Dir: $APP_DIR"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════"
echo ""

# ── Step 1: Install Docker if not present ───────────────────
if ! command -v docker &> /dev/null; then
    echo "▶ [1/6] Installing Docker..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable docker
    echo "  ✓ Docker installed: $(docker --version)"
else
    echo "▶ [1/6] Docker already installed: $(docker --version)"
fi

# ── Step 2: Firewall ────────────────────────────────────────
echo ""
echo "▶ [2/6] Configuring firewall..."
ufw allow OpenSSH 2>/dev/null || true
ufw allow 80/tcp 2>/dev/null || true
ufw allow 443/tcp 2>/dev/null || true
echo "y" | ufw enable 2>/dev/null || true
echo "  ✓ Firewall configured (SSH + HTTP + HTTPS)"

# ── Step 3: Clone / pull repo ───────────────────────────────
echo ""
if [ -d "$APP_DIR/.git" ]; then
    echo "▶ [3/6] Pulling latest code..."
    cd "$APP_DIR"
    git pull --ff-only origin main
else
    echo "▶ [3/6] Cloning repository..."
    mkdir -p "$(dirname "$APP_DIR")"
    read -rp "  Git repo URL (e.g. https://github.com/you/vehicle-erp.git): " GIT_URL
    git clone "$GIT_URL" "$APP_DIR"
    cd "$APP_DIR"
fi

# ── Step 4: Create .env if it doesn't exist ─────────────────
echo ""
if [ ! -f "$APP_DIR/.env" ]; then
    echo "▶ [4/6] Creating .env from template..."
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"

    JWT=$(openssl rand -hex 32)
    DB_PASS=$(openssl rand -hex 16)
    sed -i "s|CHANGE_ME_run_openssl_rand_hex_32|$JWT|" "$APP_DIR/.env"
    sed -i "s|CHANGE_ME_strong_password_here|$DB_PASS|" "$APP_DIR/.env"

    read -rp "  Your domain (e.g. erp.example.com): " USER_DOMAIN
    read -rp "  Your email (for SSL cert): " USER_EMAIL
    sed -i "s|erp.yourdomain.com|$USER_DOMAIN|g" "$APP_DIR/.env"
    sed -i "s|admin@yourdomain.com|$USER_EMAIL|g" "$APP_DIR/.env"

    echo "  ✓ .env created with auto-generated secrets"
    echo "  ✓ Review/edit: nano $APP_DIR/.env"
else
    echo "▶ [4/6] .env already exists, skipping"
fi

source "$APP_DIR/.env"

# ── Step 5: Get SSL certificate ─────────────────────────────
echo ""
CERT_DIR="$APP_DIR/certbot/conf/live/$DOMAIN"
if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
    echo "▶ [5/6] Getting SSL certificate for $DOMAIN..."

    mkdir -p "$APP_DIR/certbot/conf" "$APP_DIR/certbot/www"

    # Use no-ssl nginx config first
    cp "$APP_DIR/nginx/nginx-no-ssl.conf" "$APP_DIR/nginx/nginx.conf.bak"
    cp "$APP_DIR/nginx/nginx-no-ssl.conf" "$APP_DIR/nginx/nginx.conf"

    # Start just nginx + frontend to serve ACME challenge
    docker compose up -d nginx frontend

    sleep 3

    # Get the certificate
    docker compose run --rm certbot certonly \
        --webroot --webroot-path=/var/www/certbot \
        -d "$DOMAIN" \
        --email "$CERTBOT_EMAIL" \
        --agree-tos --no-eff-email

    # Restore full SSL nginx config with actual domain
    cd "$APP_DIR"
    git checkout nginx/nginx.conf 2>/dev/null || true
    sed -i "s|DOMAIN_PLACEHOLDER|$DOMAIN|g" "$APP_DIR/nginx/nginx.conf"
    rm -f "$APP_DIR/nginx/nginx.conf.bak"

    docker compose down

    echo "  ✓ SSL certificate obtained"
else
    echo "▶ [5/6] SSL certificate already exists, skipping"
fi

# Ensure domain placeholder is replaced in nginx config
sed -i "s|DOMAIN_PLACEHOLDER|$DOMAIN|g" "$APP_DIR/nginx/nginx.conf" 2>/dev/null || true

# ── Step 6: Build and start everything ──────────────────────
echo ""
echo "▶ [6/6] Building and starting all containers..."
cd "$APP_DIR"

docker compose build
docker compose up -d

echo ""
echo "  Waiting for services to start..."
sleep 10

# Run seed if first deployment
if [ "${RUN_SEED:-false}" = "true" ]; then
    echo "  Running database seed..."
    docker compose exec api node src/db/seed.js
fi

echo ""
echo "═══════════════════════════════════════════"
echo "  ✓ Deployment complete!"
echo "═══════════════════════════════════════════"
echo ""
echo "  URL:    https://$DOMAIN"
echo "  Login:  admin@demo.com / Demo@1234"
echo "          (after running seed)"
echo ""
echo "  Useful commands:"
echo "    docker compose logs -f          # all logs"
echo "    docker compose logs -f api      # API logs"
echo "    docker compose ps               # status"
echo "    docker compose restart           # restart all"
echo "    docker compose down              # stop all"
echo "    docker compose up -d --build     # rebuild & start"
echo ""
echo "  To seed demo data:"
echo "    docker compose exec api node src/db/seed.js"
echo ""
docker compose ps
