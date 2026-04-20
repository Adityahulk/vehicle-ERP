# Vehicle ERP

Full-stack ERP system for Indian vehicle distribution businesses. Manage inventory, sales, invoicing (with GST), loans, expenses, attendance, and reporting across multiple branches.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 20, Express, PostgreSQL 15, Redis 7, BullMQ |
| Frontend | React 18, Vite, Tailwind CSS, shadcn/ui, React Query, React Router v6 |
| PDF | Puppeteer |
| Auth | JWT (access 15min, refresh 7 days) |
| Notifications | Twilio WhatsApp API, 2Factor SMS |
| Deployment | PM2, Nginx, Let's Encrypt SSL |

## Prerequisites

- **Node.js** 20+ — `node -v`
- **PostgreSQL** 15+ — `psql --version`
- **Redis** 7+ — `redis-cli --version`
- **npm** 10+ — `npm -v`

## Local Development Setup

### 1. Clone and install

```bash
git clone <your-repo-url> vehicle-erp
cd vehicle-erp
```

### 2. Start PostgreSQL & Redis

**Option A — Docker (recommended):**

```bash
docker compose up -d
```

With the full Compose stack, the database is only reachable **inside** the Docker network. After the API container is healthy, run migrations and seed **in the API container** (not on the host unless you published Postgres and installed `backend/node_modules`):

```bash
docker compose exec api npm run migrate
docker compose exec api npm run seed
```

**Docker + HTTPS:** Default **`docker-compose.yml`** uses **HTTP only** (`nginx-no-ssl.conf`, port **80**, **`/var/www/certbot`**) so nginx does not crash when certs are missing. Run **certbot** (`certonly --webroot -w /var/www/certbot -d …`). When **`/etc/letsencrypt/live/<domain>/fullchain.pem`** exists, **replace** the `nginx` service in **`docker-compose.yml`** with the block in **`nginx/HTTPS-COMPOSE-SNIPPET.yml`** (do not merge a second compose file for nginx). Then `docker compose up -d --force-recreate nginx`, **`ufw allow 443`**, and set **`CORS_ORIGIN`** / **`PUBLIC_APP_URL`** to **`https://…`**.

**Option B — System-installed:**

```bash
# macOS
brew services start postgresql@15
brew services start redis

# Ubuntu
sudo systemctl start postgresql redis-server
```

### 3. Create the database

```bash
createdb vehicle_erp
```

### 4. Configure environment

```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your local values
```

### 5. Run migrations & seed

```bash
cd backend
npm install
npm run migrate
npm run seed
```

### 6. Start the frontend

```bash
cd frontend
npm install
```

### 7. Run both servers

```bash
# Terminal 1 — Backend (port 4000)
cd backend
npm run dev

# Terminal 2 — Frontend (port 5173)
cd frontend
npm run dev
```

Open http://localhost:5173 and log in:

| Email | Password | Role |
|-------|----------|------|
| admin@demo.com | VehicleERP@2026 | Company Admin |
| manager1@demo.com | VehicleERP@2026 | Branch Manager (Delhi RO) |
| manager2@demo.com | VehicleERP@2026 | Branch Manager (Satna Sales) |
| staff1@demo.com | VehicleERP@2026 | Staff (Delhi RO) |
| staff2@demo.com | VehicleERP@2026 | Staff (Satna Sales) |
| ca@demo.com | VehicleERP@2026 | CA (company-wide) |

---

## Production Deployment (Ubuntu 22.04 VPS)

Tested on DigitalOcean / Hetzner $6/mo droplets (1 vCPU, 1GB RAM, 25GB SSD).

### 1. Server setup

```bash
# SSH in as root, create deploy user
adduser deploy
usermod -aG sudo deploy
su - deploy
```

### 2. Install dependencies

```bash
# Node.js 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL 15
sudo apt install -y postgresql-15 postgresql-client-15

# Redis 7
sudo apt install -y redis-server

# Nginx
sudo apt install -y nginx

# PM2
sudo npm install -g pm2

# Certbot for SSL
sudo apt install -y certbot python3-certbot-nginx
```

### 3. Configure PostgreSQL

```bash
sudo -u postgres psql

# Inside psql:
CREATE USER vehicle_erp_user WITH PASSWORD 'your-strong-password-here';
CREATE DATABASE vehicle_erp OWNER vehicle_erp_user;
GRANT ALL PRIVILEGES ON DATABASE vehicle_erp TO vehicle_erp_user;
\q
```

### 4. Configure Redis

```bash
sudo nano /etc/redis/redis.conf
# Set: maxmemory 128mb
# Set: maxmemory-policy allkeys-lru
sudo systemctl restart redis-server
```

### 5. Deploy the application

```bash
cd /home/deploy
git clone <your-repo-url> vehicle-erp
cd vehicle-erp
```

### 6. Configure environment

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

Set production values:

```env
PORT=4000
NODE_ENV=production
DATABASE_URL=postgresql://vehicle_erp_user:your-strong-password-here@localhost:5432/vehicle_erp
REDIS_URL=redis://localhost:6379
JWT_SECRET=generate-a-64-char-random-string
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
CORS_ORIGIN=https://erp.yourdomain.com

# Optional — TaxPro e-invoice / e-way (see Environment Variables Reference)
# TAXPRO_ENV=production
# TAXPRO_ASPID=... TAXPRO_PASSWORD=...
# TAXPRO_EINV_USER_NAME=... TAXPRO_EINV_PASSWORD=...
# TAXPRO_EWB_USER_NAME=... TAXPRO_EWB_PASSWORD=...
```

Generate a secure JWT secret:

```bash
openssl rand -hex 32
```

### 7. Build and migrate

```bash
cd backend && npm ci --production
cd ../frontend && npm ci && npm run build
cd ../backend && npm run migrate && npm run seed
```

### 8. Configure Nginx

```bash
sudo cp /home/deploy/vehicle-erp/nginx.conf /etc/nginx/sites-available/vehicle-erp

# Edit domain name
sudo nano /etc/nginx/sites-available/vehicle-erp
# Replace erp.yourdomain.com with your actual domain

sudo ln -s /etc/nginx/sites-available/vehicle-erp /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### 9. SSL certificate

```bash
# Temporarily comment out the SSL server block, keep only the port 80 block
sudo certbot --nginx -d erp.yourdomain.com

# Then restore the full nginx.conf and reload
sudo cp /home/deploy/vehicle-erp/nginx.conf /etc/nginx/sites-available/vehicle-erp
sudo nginx -t && sudo systemctl reload nginx
```

### 10. Start with PM2

```bash
cd /home/deploy/vehicle-erp
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup  # follow the printed command to enable auto-start on boot
```

### 11. Subsequent deployments

```bash
cd /home/deploy/vehicle-erp
./deploy.sh
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `4000` | API server port |
| `NODE_ENV` | No | `development` | `development` or `production` |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | Yes | — | Redis connection string |
| `JWT_SECRET` | Yes | — | Secret for signing JWTs (min 32 chars) |
| `JWT_ACCESS_EXPIRY` | No | `15m` | Access token TTL |
| `JWT_REFRESH_EXPIRY` | No | `7d` | Refresh token TTL |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Allowed CORS origin |
| `UPLOAD_DIR` | No | `./uploads` | Local file upload directory |
| `MAX_FILE_SIZE` | No | `5242880` | Max upload size in bytes (5MB) |
| `PUBLIC_APP_URL` | No | `CORS_ORIGIN` | Base URL embedded in invoice/quotation share links for WhatsApp |
| `SHARE_SECRET` | No | `JWT_SECRET` | Secret for signing share-link JWTs |
| `TWO_FACTOR_API_KEY` | No | — | 2Factor.in API key for SMS |
| `TAXPRO_ENV` | No | `sandbox` | `sandbox` or `production` (default API host for e-invoice / e-way) |
| `TAXPRO_API_HOST` | No | — | Override base URL (defaults: sandbox `https://gstsandbox.charteredinfo.com`, production `https://einvapi.charteredinfo.com`) |
| `TAXPRO_ASPID` | No* | — | ASP ID from TaxPro. *Required for IRN / e-way |
| `TAXPRO_PASSWORD` | No* | — | ASP password. *Required for IRN / e-way |
| `TAXPRO_EINV_USER_NAME` | No* | — | E-invoice portal user (`User_name` on auth). Alias: set `TAXPRO_USER_NAME` for both einv and ewb |
| `TAXPRO_EINV_PASSWORD` | No* | — | E-invoice password (`eInvPwd`) |
| `TAXPRO_EWB_USER_NAME` | No* | — | E-way portal user (`username` on auth) |
| `TAXPRO_EWB_PASSWORD` | No* | — | E-way password (`ewbpwd`) |
| `TAXPRO_QR_CODE_SIZE` | No | `250` | IRN QR size query parameter |

### E-Invoice & E-Way Bill (TaxPro GSP)

Optional. When **TaxPro ASP credentials and e-invoice user/password** are set, branch managers can generate an **IRN** for **confirmed** sales invoices. **E-way bill** also requires **e-way user/password** (`TAXPRO_EWB_*`). Seller **GSTIN** and party details come from the **company** and **customer** records, not from env vars.

| Environment | Default API base (override with `TAXPRO_API_HOST`) |
|-------------|--------------------------------------------------|
| Sandbox (`TAXPRO_ENV=sandbox`) | `https://gstsandbox.charteredinfo.com` |
| Production (`TAXPRO_ENV=production`) | `https://einvapi.charteredinfo.com` |

- TaxPro overview: [TaxPro GSP API](https://gsthelp.charteredinfo.com/ucl/taxpro_gsp_api.htm)

The app exposes **`GET /api/invoices/einvoice/status`** (authenticated) returning `{ enabled, ewayConfigured, environment }` so the UI can tell whether e-invoice and full e-way credentials are present.

---

## Project Structure

```
vehicle-erp/
├── backend/
│   ├── src/
│   │   ├── config/         # db.js, redis.js
│   │   ├── controllers/    # Route handlers
│   │   ├── db/
│   │   │   ├── migrations/ # SQL migration files (001_, 002_, ...)
│   │   │   ├── migrate.js  # Migration runner
│   │   │   └── seed.js     # Demo data seeder
│   │   ├── jobs/           # BullMQ job definitions
│   │   ├── middleware/      # auth, role, validate
│   │   ├── routes/         # Express routers
│   │   ├── services/       # Business logic (GST, PDF, TaxPro e-invoice / e-way, notifications)
│   │   ├── index.js        # Express server entry point
│   │   └── worker.js       # Standalone BullMQ worker entry point
│   ├── uploads/            # File uploads (logos, signatures)
│   ├── package.json
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── components/     # UI components (shadcn/ui)
│   │   ├── pages/          # Route pages
│   │   ├── store/          # Zustand stores
│   │   ├── lib/            # API client, utils
│   │   └── App.jsx         # Router
│   ├── dist/               # Production build output
│   └── package.json
├── shared/                 # Shared types/constants
├── docker-compose.yml      # PostgreSQL 15 + Redis 7
├── ecosystem.config.js     # PM2 configuration
├── nginx.conf              # Production Nginx config
├── deploy.sh               # Deployment script
└── README.md
```

## NPM Scripts

### Backend (`cd backend`)

| Script | Command | Description |
|--------|---------|-------------|
| `npm run dev` | `nodemon src/index.js` | Start dev server with auto-reload |
| `npm start` | `node src/index.js` | Start production server |
| `npm run migrate` | `node src/db/migrate.js` | Run pending database migrations |
| `npm run seed` | `node src/db/seed.js` | Seed database with demo data |

### Frontend (`cd frontend`)

| Script | Command | Description |
|--------|---------|-------------|
| `npm run dev` | `vite` | Start dev server (port 5173) |
| `npm run build` | `vite build` | Production build to `dist/` |
| `npm run preview` | `vite preview` | Preview production build locally |

## PM2 Commands

```bash
pm2 status                    # View process status
pm2 logs                      # Stream all logs
pm2 logs vehicle-erp-api      # Stream API logs only
pm2 logs vehicle-erp-worker   # Stream worker logs only
pm2 restart all               # Restart all processes
pm2 reload ecosystem.config.js --env production  # Zero-downtime reload
pm2 monit                     # Real-time monitoring dashboard
```

## API Health Check

```bash
curl http://localhost:4000/api/health
# {"status":"ok","timestamp":"2025-04-07T12:00:00.000Z"}
```

## License

Private — All rights reserved.
