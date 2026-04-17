# DigitalOcean Droplet Deployment Guide

Complete step-by-step guide to deploy Vehicle ERP on a DigitalOcean droplet running Ubuntu 22.04.

**Recommended Droplet**: Basic $12/mo (2 vCPU, 2GB RAM, 50GB SSD) — the $6/mo (1GB RAM) works but Puppeteer PDF generation needs ~500MB so swap is required.

---

## Step 1 — Create the Droplet

1. Go to [DigitalOcean](https://cloud.digitalocean.com/) → Create → Droplets
2. Choose **Ubuntu 22.04 LTS**
3. Choose **Basic → Regular (2GB / 1 vCPU)** or higher
4. Choose a datacenter region (BLR1 for India)
5. Authentication: **SSH keys** (recommended) or password
6. Click **Create Droplet**
7. Note your droplet's **IP address** (e.g., `164.90.xxx.xxx`)

---

## Step 2 — Point Your Domain

Go to your domain registrar (GoDaddy, Namecheap, Cloudflare, etc.) and add an **A record**:

```
Type: A
Name: erp          (or @ for root domain)
Value: 164.90.xxx.xxx    (your droplet IP)
TTL: 300
```

Wait 5-10 minutes for DNS propagation. Verify with:

```bash
# Run from your local machine
ping erp.yourdomain.com
```

---

## Step 3 — Initial Server Setup

SSH into your droplet:

```bash
ssh root@164.90.xxx.xxx
```

### 3a. System update + swap (important for 1-2GB droplets)

```bash
apt update && apt upgrade -y

# Create 2GB swap (needed for Puppeteer/npm builds on small droplets)
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 3b. Create a deploy user (don't run Node apps as root)

```bash
adduser deploy
usermod -aG sudo deploy

# Copy SSH keys so you can SSH as deploy user
mkdir -p /home/deploy/.ssh
cp /root/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

### 3c. Configure firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

Now logout and SSH back as deploy user:

```bash
exit
ssh deploy@164.90.xxx.xxx
```

---

## Step 4 — Install Dependencies

Run all of these as the `deploy` user:

### 4a. Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # should show v20.x
npm -v    # should show v10.x
```

### 4b. PostgreSQL 15

```bash
sudo apt-get install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### 4c. Redis 7

```bash
sudo apt-get install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
redis-cli ping   # should say PONG
```

### 4d. Nginx

```bash
sudo apt-get install -y nginx
sudo systemctl enable nginx
```

### 4e. Certbot (SSL)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
```

### 4f. Chromium for Puppeteer (PDF generation)

```bash
sudo apt-get install -y chromium-browser
which chromium-browser   # note this path, usually /usr/bin/chromium-browser
```

### 4g. PM2 (process manager)

```bash
sudo npm install -g pm2
```

### 4h. Git

```bash
sudo apt-get install -y git
```

---

## Step 5 — Setup PostgreSQL Database

```bash
sudo -u postgres psql
```

Inside the PostgreSQL shell:

```sql
CREATE USER erp_user WITH PASSWORD 'CHANGE_THIS_TO_A_STRONG_PASSWORD';
CREATE DATABASE vehicle_erp OWNER erp_user;
GRANT ALL PRIVILEGES ON DATABASE vehicle_erp TO erp_user;
\q
```

Verify connection works:

```bash
psql -U erp_user -d vehicle_erp -h localhost -W
# Enter your password, then type \q to exit
```

---

## Step 6 — Clone and Configure the App

```bash
sudo mkdir -p /var/www
sudo chown deploy:deploy /var/www
git clone https://github.com/YOUR_USERNAME/vehicle-erp.git /var/www/vehicle-erp
cd /var/www/vehicle-erp
```

### 6a. Create the .env file

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Fill in production values:

```env
PORT=4000
NODE_ENV=production

DATABASE_URL=postgresql://erp_user:CHANGE_THIS_TO_A_STRONG_PASSWORD@localhost:5432/vehicle_erp

REDIS_URL=redis://localhost:6379

JWT_SECRET=PASTE_A_64_CHAR_RANDOM_STRING_HERE
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

CORS_ORIGIN=https://erp.yourdomain.com

UPLOAD_DIR=./uploads
MAX_FILE_SIZE=5242880

# Optional — fill when ready (SMS; WhatsApp uses wa.me + share links, no Twilio)
PUBLIC_APP_URL=https://erp.yourdomain.com
TWO_FACTOR_API_KEY=
```

Generate a secure JWT secret:

```bash
openssl rand -hex 32
```

### 6b. Create required directories

```bash
mkdir -p logs
mkdir -p backend/uploads/logos
mkdir -p backend/uploads/signatures
```

---

## Step 7 — Install, Migrate, Seed, Build

### 7a. Backend

```bash
cd /var/www/vehicle-erp/backend
npm ci --omit=dev
node src/db/migrate.js
node src/db/seed.js
```

You should see the seed output with login credentials.

### 7b. Frontend

```bash
cd /var/www/vehicle-erp/frontend
npm ci
npm run build
```

Verify the build output exists:

```bash
ls -la dist/index.html   # should exist
```

---

## Step 8 — Configure Nginx

### 8a. Edit the nginx config with your actual domain

```bash
cd /var/www/vehicle-erp
sed -i 's/erp.yourdomain.com/YOUR_ACTUAL_DOMAIN/g' nginx.conf
```

### 8b. First, create a temporary HTTP-only config for SSL certificate

```bash
sudo tee /etc/nginx/sites-available/vehicle-erp > /dev/null <<'EOF'
server {
    listen 80;
    server_name YOUR_ACTUAL_DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    root /var/www/vehicle-erp/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
```

Replace `YOUR_ACTUAL_DOMAIN` in the command above with your domain.

```bash
sudo ln -sf /etc/nginx/sites-available/vehicle-erp /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo mkdir -p /var/www/certbot
sudo nginx -t
sudo systemctl reload nginx
```

### 8c. Get SSL certificate

```bash
sudo certbot --nginx -d YOUR_ACTUAL_DOMAIN
```

Follow the prompts (enter email, agree to TOS). Certbot will auto-configure SSL.

### 8d. Now replace with the full production config

```bash
sudo cp /var/www/vehicle-erp/nginx.conf /etc/nginx/sites-available/vehicle-erp
sudo nginx -t
sudo systemctl reload nginx
```

### 8e. Verify SSL auto-renewal

```bash
sudo certbot renew --dry-run
```

---

## Step 9 — Start the Application with PM2

```bash
cd /var/www/vehicle-erp
pm2 start ecosystem.config.js --env production
```

Verify everything is running:

```bash
pm2 status
```

You should see:

```
┌────┬──────────────────────┬──────┬───────┬────────┬──────────┐
│ id │ name                 │ mode │ ↺     │ status │ cpu      │
├────┼──────────────────────┼──────┼───────┼────────┼──────────┤
│ 0  │ vehicle-erp-api      │ cluster │ 0  │ online │ 0%       │
│ 1  │ vehicle-erp-api      │ cluster │ 0  │ online │ 0%       │
│ 2  │ vehicle-erp-worker   │ fork    │ 0  │ online │ 0%       │
└────┴──────────────────────┴──────┴───────┴────────┴──────────┘
```

### 9a. Enable PM2 auto-start on reboot

```bash
pm2 save
pm2 startup
```

PM2 will print a command like:

```
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u deploy --hp /home/deploy
```

Copy-paste and run that exact command.

### 9b. Test the health endpoint

```bash
curl http://localhost:4000/api/health
# {"success":true,"data":{"status":"ok","timestamp":"..."}}
```

---

## Step 10 — Verify Everything Works

1. Open `https://erp.yourdomain.com` in your browser
2. You should see the login page
3. Login with: `admin@demo.com` / `VehicleERP@2026`
4. Check that the dashboard loads with seed data

---

## Subsequent Deployments

After pushing changes to your git repo, SSH into the server and run:

```bash
cd /var/www/vehicle-erp
./deploy.sh
```

This will: pull latest code → install deps → build frontend → run migrations → zero-downtime PM2 reload.

---

## Useful Commands

### Logs

```bash
pm2 logs                        # stream all logs
pm2 logs vehicle-erp-api        # API logs only
pm2 logs vehicle-erp-worker     # worker logs only
tail -f /var/log/nginx/vehicle-erp-error.log   # Nginx errors
```

### Restart / Stop

```bash
pm2 restart all
pm2 stop all
pm2 reload ecosystem.config.js --env production   # zero-downtime
```

### Database

```bash
# Connect to database
psql -U erp_user -d vehicle_erp -h localhost

# Run migrations manually
cd /var/www/vehicle-erp/backend && node src/db/migrate.js

# Re-seed (WARNING: deletes and recreates demo data)
cd /var/www/vehicle-erp/backend && node src/db/seed.js
```

### Monitor

```bash
pm2 monit         # real-time CPU/memory dashboard
htop              # system resources
df -h             # disk usage
free -m           # memory usage
```

### Redis

```bash
redis-cli
> KEYS *           # see all keys
> DBSIZE           # count keys
> INFO memory      # memory usage
```

---

## Troubleshooting

### "502 Bad Gateway" from Nginx

The Node.js app isn't running or crashed:

```bash
pm2 status                # check if processes are online
pm2 logs vehicle-erp-api  # check for errors
```

### "ECONNREFUSED" on database

PostgreSQL isn't running or credentials are wrong:

```bash
sudo systemctl status postgresql
psql -U erp_user -d vehicle_erp -h localhost -W   # test connection
cat /var/www/vehicle-erp/backend/.env | grep DATABASE_URL
```

### Puppeteer/PDF errors

Chromium isn't installed or path is wrong:

```bash
which chromium-browser
# If missing: sudo apt-get install -y chromium-browser
```

### Frontend shows blank page

Build might have failed or Nginx root path is wrong:

```bash
ls -la /var/www/vehicle-erp/frontend/dist/index.html
sudo nginx -t
```

### Disk space full

```bash
df -h
pm2 flush          # clear PM2 logs
sudo journalctl --vacuum-time=7d   # clear old system logs
```

### Redis connection errors

```bash
sudo systemctl status redis-server
redis-cli ping   # should return PONG
```
