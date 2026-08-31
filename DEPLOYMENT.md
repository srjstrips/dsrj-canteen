# Deployment Guide — DSRJ Canteen

Single-VPS production deployment using Docker Compose. The stack is **Nginx**
(serves the React SPA + proxies the API), the **Node/Express API**, and
**PostgreSQL**. Runs over HTTP on the VPS IP (add a domain + HTTPS later).

## Architecture

```
Internet ──80──> Nginx (web container) ──/api,/uploads──> API (node) ──> Postgres
                    │                                         │
                    └── serves built React static files       └── volumes: db data + uploaded images
```

Only port **80** is exposed. Postgres and the API are internal to the compose
network.

## One-time VPS setup

1. **Provision** a small VPS (2 vCPU / 2–4 GB RAM is plenty). Ubuntu 22.04+.
2. **Install Docker** (includes Compose v2):
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. **Firewall** — allow SSH + HTTP only:
   ```bash
   ufw allow OpenSSH && ufw allow 80/tcp && ufw enable
   ```
4. **Clone the repo:**
   ```bash
   sudo mkdir -p /opt/dsrj-canteen && sudo chown "$USER" /opt/dsrj-canteen
   git clone <YOUR_REPO_URL> /opt/dsrj-canteen
   cd /opt/dsrj-canteen
   ```
5. **Create secrets:**
   ```bash
   cp .env.production.example .env.production
   # set POSTGRES_PASSWORD, DATABASE_URL password, and JWT_SECRET:
   openssl rand -hex 32   # paste into JWT_SECRET
   nano .env.production
   ```

## First deploy

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

The API container **runs migrations automatically** on start. Then seed the
first admin + demo data (once):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec api node dist/db/seed.js
```

Open `http://<VPS_IP>/` and log in (`admin` / `Password@123` — **change it**).

## Day-to-day changes

- **Business data** (products, food items, prices, categories, users, billing
  accounts, images, data reset) → done in the **Admin/Canteen panels**. No
  deploy needed.
- **Code changes** → push to `main`, then deploy:
  - **Manual button:** GitHub → Actions → **CI** → *Run workflow* → check
    "deploy". Tests run first; on success it SSHes to the VPS and runs
    `scripts/deploy.sh`.
  - **Or on the VPS directly:** `./scripts/deploy.sh`

## CI/CD

`.github/workflows/ci.yml`:
- Every push/PR to `main`: install → typecheck (server + web) → **run tests
  against a Postgres service** → build both.
- Manual `workflow_dispatch` with `deploy=true`: after tests pass, SSH-deploy.

**Required GitHub secrets** (Settings → Secrets → Actions):
`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` (private key), `VPS_APP_DIR`
(e.g. `/opt/dsrj-canteen`).

## Backups

Nightly DB + uploads backup with 7-day retention:

```bash
crontab -e
# 0 2 * * *  cd /opt/dsrj-canteen && ./scripts/backup.sh >> /var/log/dsrj-backup.log 2>&1
```

Copy `/opt/dsrj-backups` off-box (e.g. `rclone` to object storage) for real
disaster recovery.

## Restore

```bash
gunzip -c /opt/dsrj-backups/db-XXXX.sql.gz | \
  docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres \
  psql -U dsrj -d dsrj_canteen
```

## Recommended hardening (before real production)

- Add **login rate-limiting**, mask 500 error bodies, pin JWT algorithm
  (see the security review notes).
- Add a **domain + HTTPS** (Let's Encrypt / Certbot or Caddy) and set
  `CORS_ORIGIN` to that domain.
- `unattended-upgrades` for OS security patches; `fail2ban` for SSH.
