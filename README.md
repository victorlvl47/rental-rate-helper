# RentalRateHelper

RentalRateHelper is a local web application for exploring deterministic rental
market data and pricing previews by city. It includes a read-only AI pricing
preview that adds structured explanation, confidence, and risk metadata without
changing the authoritative deterministic price or range.

## Architecture

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
# The local deterministic AI-pricing stub is the default and needs no key.
AI_PROVIDER=stub
# Required only when AI_PROVIDER=openai. Never commit a real key.
OPENAI_API_KEY=
# Optional; defaults to gpt-5.6.
OPENAI_MODEL=
```

The API imports the database package, which loads the repository-root `.env`.
`pnpm --filter api dev` therefore uses that file; `apps/api/.env` is not loaded
by the API startup command. The committed example keeps the stub enabled. To
run a smoke test independently of any local OpenAI setting, set
`AI_PROVIDER=stub` on the API command below.

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
AI_PROVIDER=stub pnpm --filter api dev
```

`pnpm infra:up` starts the local Docker services, including PostgreSQL. Run
migrations before seeding. The seed contains eight fixed fake properties and
sixteen fake market signals: at least two properties for each supported market.
It is safe to rerun `pnpm --filter database db:seed`; known fixed records are
updated rather than duplicated.

The API listens at `http://localhost:8080` by default (the `API_PORT` value in
the repository-root `.env`). Start it in a separate terminal after the database
has been migrated and seeded. The command above explicitly selects the
credential-free stub, even if `.env` has an OpenAI configuration.

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

### Epic 4 AI pricing verification

Use this reproducible local smoke path. It requires no OpenAI key and makes no
network request: the explicit `AI_PROVIDER=stub` process returns deterministic
structured metadata.

```bash
pnpm infra:up
pnpm --filter database db:migrate
pnpm --filter database db:seed
AI_PROVIDER=stub pnpm --filter api dev
```

Leave the API running in that terminal. In another terminal, call the seeded
property twice and compare the complete JSON responses:

```bash
curl --fail --silent --show-error \
  http://localhost:8080/properties/10000000-0000-4000-8000-000000000001/ai-pricing-preview \
  -o /tmp/rental-rate-helper-ai-preview-1.json
curl --fail --silent --show-error \
  http://localhost:8080/properties/10000000-0000-4000-8000-000000000001/ai-pricing-preview \
  -o /tmp/rental-rate-helper-ai-preview-2.json
cmp /tmp/rental-rate-helper-ai-preview-1.json /tmp/rental-rate-helper-ai-preview-2.json
```

`cmp` exits successfully when the responses are identical. The JSON contains
`rule_based_pricing` (including numeric USD prices, safe range, adjustment
breakdown, signal count, and whether signals were used) and
`ai_recommendation` (the same recommended price plus a non-empty explanation,
confidence from 0 to 1, and an allowed risk level). For the seeded property,
expect price `216.55`, range `205.72`–`227.38`, confidence `0.8`, and risk
`low`. The deterministic result is authoritative: the AI provider cannot alter
its recommended price or range. The endpoint is read-only and does not save
recommendations.

Check the validation cases as well:

```bash
curl -i http://localhost:8080/properties/not-a-uuid/ai-pricing-preview
curl -i http://localhost:8080/properties/10000000-0000-4000-8000-000000000099/ai-pricing-preview
```

The first returns `400` with `{"error":"Invalid property ID."}`; the second
returns `404` with `{"error":"Property not found."}`.

### Offline pricing validation eval

Run the checked-in pricing validation/eval suite from the repository root:

```bash
pnpm --filter api eval:pricing
```

This no-credential command uses static in-memory fixtures only. It requires no
API key, OpenAI request, network access, database, Temporal worker, or other
infrastructure service. It prints one deterministic `PASS` or `FAIL` line per
case with the expected and actual classification, followed by a final summary.

The deterministic rule-based result is the authoritative source of the price
and safe range. An AI preview returns AI metadata only when it passes
validation; invalid metadata is safely rejected with a `422` response and its
safe issue codes. The preview is read-only, so a rejected response does not
save a recommendation.

## Temporal pricing workflow

The durable recommendation path is separate from both preview endpoints. A
request is idempotent by `property_id + pricing_date`; the API and worker use
the same deterministic workflow ID (`pricing-<property-id>-<YYYY-MM-DD>`).
The deterministic engine owns the price and range. AI supplies only validated
explanation, confidence, and risk metadata.

Run the local stub path in this order:

```bash
pnpm infra:up
pnpm --filter database db:migrate
pnpm --filter database db:seed
AI_PROVIDER=stub pnpm --filter api dev
pnpm --filter worker dev
```

Start a request (the response is immediate; it does not wait for AI):

```bash
curl -i -X POST http://localhost:8080/properties/10000000-0000-4000-8000-000000000001/pricing-recommendations \
  -H 'content-type: application/json' \
  -d '{"pricing_date":"2026-09-14"}'
curl -i 'http://localhost:8080/properties/10000000-0000-4000-8000-000000000001/pricing-recommendations/status?pricing_date=2026-09-14'
```

Repeat the POST with the same date to resolve the same logical workflow and
durable request. Status responses expose only lifecycle state, safe validation
issue codes, accepted metadata, and known metrics; raw prompts/provider bodies
and credentials are never stored or returned. The stub has no token or cost
usage, so those fields remain `null` rather than being invented.

`pnpm --filter api eval:pricing` remains the credential-free, deterministic
offline validation suite. It does not need PostgreSQL, Temporal, or OpenAI.
The workflow path above is local/manual verification with the stub provider.
An OpenAI smoke check is optional and manual: configure `AI_PROVIDER=openai`
and `OPENAI_API_KEY` locally, then run the same start/status sequence; never
use it as automated coverage.

### Local Temporal retry-recovery integration test

This focused test starts a real worker on the normal pricing task queue and a
real workflow. Its test-only provider fails twice with transient errors, then
returns valid deterministic metadata on the third attempt. It requires the
local Docker services and seeded data, but never uses OpenAI or network AI
access:

```bash
pnpm infra:up
pnpm --filter database db:migrate
pnpm --filter database db:seed
pnpm --filter worker test:temporal-retry
```

The test uses a unique test date and removes its scoped workflow request,
recommendation, and metrics rows during teardown.

The current pricing policies intentionally expose an unresolved conflict: the
deterministic engine permits a total adjustment up to ±35%, while validation
rejects a single price increase above 30%. An authoritative result above 30%
is therefore rejected rather than silently clamped or mutated. Reconciling
these limits requires a future pricing-policy decision.

Run the automated verification suite from the repository root:

```bash
pnpm --filter shared test
pnpm --filter api test
pnpm --filter api eval:pricing
pnpm build
pnpm typecheck
git diff --check
```

OpenAI is optional and intentionally manual. To use it, set
`AI_PROVIDER=openai` and a real `OPENAI_API_KEY` only in the ignored
repository-root `.env`; `OPENAI_MODEL` is optional. Do not add a key to a
tracked file. This is not required for the stub smoke path or automated tests.

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
