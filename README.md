# RentalRateHelper

RentalRateHelper is a foundation for a web application that will analyze rental
market data and recommend competitive rental rates by city. Epic 1 supplies the
local development platform only; it does not include rental-pricing features.

## Epic 1 architecture

```text
Next.js dashboard → Fastify API → Drizzle → PostgreSQL
                         ↓
                  Temporal client
                         ↓
                   Temporal server
                         ↓
                   Temporal worker
```

The Temporal worker currently hosts only a deterministic smoke-test workflow.
It invokes one activity and returns a fixed confirmation message.

## Prerequisites

- Node.js 20 or later
- pnpm 10.15.0 (`corepack enable` can install the version declared in
  `package.json`)
- Docker and Docker Compose, with permission to run `docker compose`

## Local setup

From the repository root, install dependencies and create a local environment
file:

```bash
pnpm install
cp .env.example .env
```

`.env` is ignored by Git. The tracked `.env.example` contains development-only
values:

```dotenv
DATABASE_URL=postgresql://rental_rate_helper:rental_rate_helper_local@localhost:5433/rental_rate_helper
API_PORT=8080
NEXT_PUBLIC_API_URL=http://localhost:8080
TEMPORAL_ADDRESS=localhost:7233
TEMPORAL_TASK_QUEUE=rental-rate-helper
```

Start the infrastructure without removing persistent data:

```bash
pnpm infra:up
docker compose ps
```

If Docker requires elevated permissions, use `sudo docker compose up -d` and
`sudo docker compose ps` instead. Never use `docker compose down -v` for normal
development because it deletes the PostgreSQL volume.

Start the dashboard, API, and Temporal worker together:

```bash
pnpm dev
```

`pnpm dev` first builds the database package so the API can resolve it from a
fresh clone, then starts all three applications in parallel.

## Local service addresses

```text
Dashboard:       http://localhost:3000
API:             http://localhost:8080
API health:      http://localhost:8080/health
PostgreSQL:      localhost:5433
Temporal:        localhost:7233
Temporal Web UI: http://localhost:8233
```

Confirm the API and PostgreSQL connection:

```bash
curl -i http://localhost:8080/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "rental-rate-helper-api",
  "database": "connected"
}
```

If PostgreSQL is unavailable, this endpoint returns HTTP `503` and a safe
response with `"database": "disconnected"`; it does not return credentials.
After PostgreSQL recovers, the next health request should return HTTP `200`.

## Temporal smoke test

With infrastructure and `pnpm dev` running, start and wait for the smoke
workflow:

```bash
pnpm temporal:smoke
```

The command prints a unique `rental-rate-helper-smoke-...` workflow ID and this
result:

```text
RentalRateHelper Temporal smoke test completed
```

Open Temporal Web UI at http://localhost:8233 and search for that workflow ID.
The worker logs its Temporal address and task queue when it begins polling.

If Temporal is unavailable, the worker and smoke client print a concise
connection error naming the configured Temporal address. Start or restart the
infrastructure with `pnpm infra:up`, wait for `docker compose ps` to show
healthy/completed setup services, then rerun the worker or smoke command.

## Build, checks, migrations, and sample data

```bash
pnpm build
pnpm typecheck
```

When a later issue adds Drizzle schemas, generate and apply migrations with:

```bash
pnpm --filter database db:generate
pnpm --filter database db:migrate
```

With PostgreSQL running and migrations applied, load the deterministic local MVP sample data with:

```bash
pnpm --filter database db:seed
```

The seed inserts clearly fake data for local development only: it includes all four MVP markets, uses USD prices, and is safe to rerun. Repeated runs update the known sample properties and market signals instead of creating duplicates.

## Stopping local services

Use `Ctrl+C` to stop `pnpm dev`; the API closes its PostgreSQL pool and the
Temporal worker performs a graceful shutdown. Stop containers while preserving
the PostgreSQL volume with:

```bash
pnpm infra:down
```

## Epic 1 smoke-test checklist

- [ ] Run `pnpm install`.
- [ ] Run `cp .env.example .env`.
- [ ] Run `pnpm infra:up` and confirm with `docker compose ps`.
- [ ] Run `pnpm dev`.
- [ ] Open http://localhost:3000.
- [ ] Call http://localhost:8080/health and confirm `database: connected`.
- [ ] Run `pnpm temporal:smoke`.
- [ ] Confirm its successful result and find the workflow ID in Temporal Web UI.
- [ ] Run `pnpm build` and `pnpm typecheck`.
- [ ] Stop applications with `Ctrl+C` and run `pnpm infra:down`.
