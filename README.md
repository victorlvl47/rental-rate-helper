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

When a database schema change requires a migration, generate and apply it with:

```bash
pnpm --filter database db:generate
pnpm --filter database db:migrate
```

With PostgreSQL running and migrations applied, load the deterministic local MVP sample data with:

```bash
pnpm --filter database db:seed
```

The seed inserts clearly fake data for local development only: it includes all four MVP markets, uses USD prices, and is safe to rerun. Repeated runs update the known sample properties and market signals instead of creating duplicates.

## Epic 2 market-data flow

Epic 2 adds read-only, fake rental market data for local MVP development. It
does not generate pricing recommendations.

### Prerequisites and local configuration

Install Node.js 20 or later, pnpm 10.15.0, Docker, and Docker Compose. Docker
must be running and your user must have permission to use `docker compose`.
PostgreSQL must be available before migrations, seeding, `/health`, or the
market-data API routes can work.

Create the local environment file from the tracked template; do not commit it:

```bash
cp .env.example .env
```

For the default local setup, `.env.example` configures PostgreSQL on port 5433
and the API on port 8080. Keep credentials local; use different values in your
own `.env` when needed.

### Start, migrate, seed, and run the API

From the repository root, run the commands in this order:

```bash
pnpm infra:up
pnpm --filter database db:migrate
pnpm --filter database db:seed
pnpm --filter api dev
```

`pnpm infra:up` starts the local Docker services, including PostgreSQL. Run
migrations before seeding. The seed contains eight fixed fake properties and
sixteen fake market signals: at least two properties for each supported market.
It is safe to rerun `pnpm --filter database db:seed`; known fixed records are
updated rather than duplicated.

The API listens at `http://localhost:8080` by default (the `API_PORT` value in
`.env`). Start it in a separate terminal with `pnpm --filter api dev` after the
database has been migrated and seeded.

### Data rules

The only supported markets are:

- New York
- Las Vegas
- Guatemala City
- Toronto

All prices are USD-only JSON numbers. Dates are calendar dates in `YYYY-MM-DD`
format. PostgreSQL numeric values are converted and validated by the API, so
clients receive JSON numbers rather than numeric strings.

### Read-only API examples

With the API running at `http://localhost:8080`, use these requests:

```bash
curl -i http://localhost:8080/health
curl -i http://localhost:8080/markets
curl -i 'http://localhost:8080/properties?city=New%20York'
curl -i 'http://localhost:8080/properties?city=Las%20Vegas'
curl -i 'http://localhost:8080/properties?city=Guatemala%20City'
curl -i 'http://localhost:8080/properties?city=Toronto'
curl -i http://localhost:8080/properties/10000000-0000-4000-8000-000000000001/market-signals
curl -i http://localhost:8080/properties/10000000-0000-4000-8000-000000000001/pricing-preview
curl -i http://localhost:8080/properties/10000000-0000-4000-8000-000000000001/ai-pricing-preview
```

`10000000-0000-4000-8000-000000000001` is the fixed ID for the seeded Sample
Harbor Studio property. Its market signals are returned in ascending date order.

### AI pricing preview smoke path

After starting infrastructure, applying migrations, and seeding with the commands
above, run the final curl command in the read-only API examples. It returns the
authoritative deterministic `rule_based_pricing` result alongside an
`ai_recommendation`. `AI_PROVIDER=stub` is the local default, so this smoke path
requires no OpenAI API key and makes no network call. The endpoint is read-only:
it does not save a recommendation.

| Scenario | Expected response |
| --- | --- |
| Missing `city` | `400` |
| Unsupported `city` | `400` |
| Invalid property UUID | `400` |
| Unknown valid property UUID | `404` |
| Valid city with no properties | `200` with `[]` |
| Existing property with no signals | `200` with `[]` |
| Database unavailable | `503` |

### Safe empty-database migration verification

Never reset, truncate, or drop the normal `rental_rate_helper` development
database to test migrations. With PostgreSQL running, use this explicitly named
temporary database instead:

These commands use the default `.env.example` credentials and port; if you
changed your local PostgreSQL settings, replace them with your own `.env`
values.

```bash
docker compose exec -T postgresql createdb -U rental_rate_helper rental_rate_helper_issue12_verify
DATABASE_URL=postgresql://rental_rate_helper:rental_rate_helper_local@localhost:5433/rental_rate_helper_issue12_verify pnpm --filter database db:migrate
docker compose exec -T postgresql psql -U rental_rate_helper -d rental_rate_helper_issue12_verify -c '\dt'
```

After confirming the migration tables and expected application tables exist,
remove only that named verification database. First print the exact target, then
run the drop command:

```bash
printf '%s\n' 'Removing only temporary database: rental_rate_helper_issue12_verify'
docker compose exec -T postgresql dropdb -U rental_rate_helper rental_rate_helper_issue12_verify
```

This empty database can also safely verify that a valid market returns `[]`.
Point a separate API process at it with an explicit `DATABASE_URL` and a
different `API_PORT`; do not repoint or alter the normal seeded database.

### Epic 2 smoke-test checklist

- [ ] PostgreSQL is running (`pnpm infra:up` and `docker compose ps`).
- [ ] Migrations succeed on the explicitly named empty verification database.
- [ ] The normal database migrates, then `db:seed` succeeds twice with no duplicate fixed IDs or `(property_id, date)` pairs.
- [ ] `/health` reports a connected database and `/markets` returns all four markets.
- [ ] Each supported city returns its seeded properties.
- [ ] A seeded property returns date-ascending signals with JSON numeric prices and `YYYY-MM-DD` dates.
- [ ] Missing/unsupported cities, invalid UUIDs, and unknown UUIDs return the documented statuses.
- [ ] Valid empty results and database-failure behavior are covered by API tests; manually verify them with the temporary database only when safe.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm --filter shared test`, `pnpm --filter api test`, and `git diff --check` pass.

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
