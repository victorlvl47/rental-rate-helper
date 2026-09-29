# Security boundaries

RentalRateHelper is a local MVP using intentionally fake rental data. It is not an authorization, billing, or customer-data system. Its security design focuses on keeping provider input/output constrained and operational telemetry safe.

## Secrets and configuration

- Copy `.env.example` to the ignored root `.env` for local values.
- Never commit `OPENAI_API_KEY`, `SENTRY_DSN`, database credentials, or provider responses.
- The default `AI_PROVIDER=stub` needs no credentials.
- Optional Sentry is disabled when `SENTRY_DSN` is blank.

## AI and prompt-injection boundary

The model is not the pricing authority. It receives a constrained deterministic result and is asked only for structured explanation metadata. Structured output and shared schema validation reject unexpected shape or content. The accepted AI price must exactly match the authoritative deterministic price.

This limits the impact of malformed provider output and reduces prompt-injection exposure; it does not make arbitrary future external data safe by itself. A future live-data adapter must validate and normalize untrusted input before it reaches the pricing or AI layers.

## Safe output and telemetry

Validation rejects blank explanations, invalid confidence/risk values, prices outside property bounds or the deterministic range, price mismatches, and values above the 30% increase policy.

Structured logs and Sentry context retain only safe operational identifiers and categories, such as service, component, event, failure type, workflow ID, property ID, and pricing date. Prompts, raw provider payloads, credentials, database URLs, request bodies, and raw exception details are excluded from Sentry context and API responses.

## Data handling

Seed data is explicitly fake. Before using customer data, add authentication and authorization, data-retention rules, privacy review, tenant isolation, audit requirements, and a secure integration boundary. Those are deliberately outside this MVP.
