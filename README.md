# RentalRateHelper

Web app that analyzes rental market data and recommends competitive rental rates by city.

## Project structure

```text
apps/
├── web/       
├── api/       
└── worker/    
packages/
├── shared/    Reusable TypeScript types and utilities
└── database/  
docs/          Project documentation
```

## Local infrastructure

Start the local PostgreSQL and Temporal services from the repository root:

```bash
docker compose up -d
docker compose ps
docker compose logs
docker compose down
```

Services are available at:

```text
PostgreSQL:    localhost:5433
Temporal gRPC: localhost:7233
Temporal UI:   http://localhost:8233
Fastify API:   http://localhost:8080
Next.js web:   http://localhost:3000
```

The local application database is `rental_rate_helper`. The Compose configuration
uses development-only credentials. Configure the API and database tooling from the
repository root:

```bash
cp .env.example .env
```

This sets `DATABASE_URL` to the local PostgreSQL instance. The real `.env` file is
ignored by Git. To run the API and confirm PostgreSQL connectivity:

```bash
pnpm --filter api dev
curl http://localhost:8080/health
```

The healthy response is:

```json
{
  "status": "ok",
  "service": "rental-rate-helper-api",
  "database": "connected"
}
```

When schemas are added in a future issue, generate and apply migrations with:

```bash
pnpm --filter database db:generate
pnpm --filter database db:migrate
```

`docker compose down` stops and removes containers while preserving the named
PostgreSQL volume. `docker compose down -v` also deletes that volume and its data.
