# MyFin

Personal finance app: a React web UI (`myfin-web/`) talking to a Node/Express + Prisma API (`myfin-api/`) backed by MySQL.
This fork adds PhonePe CSV import, a phone share app, analytics, planning and more (see `docs/`).

Works the same on macOS, Linux and Windows. The only OS-specific bits are noted inline.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 20.19+, 22.12+ or 24+ | Check with `node -v`. Use [nvm](https://github.com/nvm-sh/nvm) / [nvm-windows](https://github.com/coreybutler/nvm-windows) if needed |
| Docker Desktop (or Docker Engine + Compose) | any recent | Easiest way to get MySQL. Skip if you already run MySQL 8 |
| Git | any | |

## Quick start (development)

You need three things running: MySQL, the API (port 3001), and the web app (port 5173).

### 1. Clone

```sh
git clone https://github.com/Ajayghoshm/myfin.git
cd myfin
```

### 2. Start MySQL

```sh
docker compose up -d db
```

This starts MySQL 8.4 with database `myfin`, user `myfin`, password `myfinpassword`.
Note: the root `docker-compose.yml` publishes it on port **3306**.

> Already have MySQL? Create a database and user yourself and point the API at it in step 3.

### 3. Start the API

```sh
cd myfin-api
cp .env.example .env        # Windows (cmd): copy .env.example .env
```

Edit `.env` so the DB settings match your MySQL. For the Docker DB from step 2:

```
DB_HOST=localhost
DB_PORT=3306
DB_NAME=myfin
DB_USER=myfin
DB_PW=myfinpassword
DATABASE_URL="mysql://myfin:myfinpassword@localhost:3306/myfin"
NODE_ENV=development
```

SMTP values can stay as placeholders unless you need password-reset emails.

Then install and run. **The app uses Indian time**, so set the timezone `TZ=Asia/Kolkata` (change it if you want another zone):

```sh
npm install

# macOS / Linux
TZ=Asia/Kolkata npm run start:dev

# Windows PowerShell
$env:TZ="Asia/Kolkata"; npm run start:dev
```

`start:dev` generates the Prisma client and runs `prisma migrate deploy` on every start, so the schema is always up to date.
**Back up your database first if it holds real data and the branch has new migrations.**

The API is now on <http://localhost:3001>.

### 4. Start the web app

In a second terminal:

```sh
cd myfin-web
cp .env.example .env        # Windows (cmd): copy .env.example .env
npm install
npm run dev
```

`.env` should contain `VITE_MYFIN_BASE_API_URL=http://localhost:3001`.
Open the URL Vite prints (normally <http://localhost:5173>) and create an account (signup is enabled by default via `ENABLE_USER_SIGNUP=true`).

## Docker only (no Node needed)

```sh
cp .env.example .env     # fill SMTP_* (can be dummy values)
docker compose up -d
```

- Web: <http://localhost:8181>, API: <http://localhost:3001>
- Before first use, set `VITE_MYFIN_BASE_API_URL` in `docker-compose.yml` to a URL your browser can reach, e.g. `http://localhost:3001`.
- **Caveat:** this uses the upstream images (`ghcr.io/afaneca/myfin*`), so it does **not** include this fork's extra features. Use the development flow above to run the fork's code.

## Useful commands

From `myfin-api/`:

| Command | What it does |
| --- | --- |
| `npm run start:dev` | Run the API with migrations applied |
| `npm run test:unit:run` | Unit tests |
| `npm run test:integration` | Integration tests (need a throwaway DB named `myfin_tests`; never point at real data) |
| `npm run check` | Lint + format check (Biome) |
| `npm run db:migrate` | Create a new Prisma migration during development |

From `myfin-web/`:

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Type-check and production build into `dist/` |
| `npm run lint` | Lint |

## Optional features

- **Encrypted backups to a synced folder:** set `BACKUP_DIR` in `myfin-api/.env` (e.g. a Google Drive / Dropbox folder).
- **Phone share app (send PhonePe statements from your phone):** see [docs/phone-share-pwa.md](docs/phone-share-pwa.md). It needs [mkcert](https://github.com/FiloSottile/mkcert) (`brew install mkcert` on macOS, `choco install mkcert` on Windows, your package manager on Linux).

## Troubleshooting

- **`ECONNREFUSED` / can't reach DB:** check `docker ps` shows `db` healthy and the port in `.env` matches the published port (3306 with the root compose file).
- **Port already in use:** stop any local MySQL on 3306, or change the left side of `"3306:3306"` in `docker-compose.yml` and update `DB_PORT`/`DATABASE_URL`.
- **Web app can't log in / network error:** confirm the API is up on 3001 and `VITE_MYFIN_BASE_API_URL` is correct. Restart `npm run dev` after editing `.env`.
- **Dates are off by a day:** the API was started without `TZ` set.
- **Unsupported Node version:** upgrade to a version listed in the prerequisites.
