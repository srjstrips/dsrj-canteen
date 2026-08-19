# Divya SRJ Canteen — Inventory & Billing Management System

Production-oriented inventory and billing system for Divya SRJ Biscuit
Manufacturing Company's internal canteen, with module-wise role-based access
for **ADMIN**, **STORE** and **CANTEEN** users.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the business flow,
database schema and API design — read that first.

## Stack

- **Backend**: Node.js, Express, TypeScript, PostgreSQL via plain SQL (`pg`, no ORM)
- **Frontend**: React + TypeScript (Vite), Tailwind CSS, TanStack Query, installable as a PWA with offline POS billing
- **Auth**: JWT, bcrypt password hashing, role-based middleware

## Monorepo layout

```
server/   Express API, SQL schema/migrations, stock ledger engine, tests
web/      React web app (desktop-first, responsive, offline-capable)
docs/     Architecture & schema documentation
```

## Getting started (local development)

Docker is optional — it's just the fastest way to get Postgres running. If
you already have PostgreSQL installed locally, skip straight to step 2 and
point `DATABASE_URL` in `server/.env` at your own database instead (create
one with `createdb dsrj_canteen`, or the `CREATE DATABASE` equivalent).

```bash
# 1. Start Postgres (skip this if you're using your own local Postgres)
docker compose up -d

# 2. Install dependencies
npm install

# 3. Configure env
cp server/.env.example server/.env
cp web/.env.example web/.env

# 4. Migrate + seed the database (creates demo admin/store/canteen users
#    and runs the Day1-5 weighted-average scenario from the spec as seed data)
npm run db:migrate
npm run db:seed

# 5. Run everything
npm run dev:server   # http://localhost:4000
npm run dev:web      # http://localhost:5173
```

Demo logins (seeded) — log in with username: `admin` / `store` / `canteen` / `hod`,
password `Password@123` for all four.

## Tests

```bash
npm run test:server
```

Includes an automated test that replays the exact Day 1-5 Rice weighted
average scenario from the spec and asserts the resulting average rate/value
at each step (Rs.50 -> Rs.51.92 -> ...).
