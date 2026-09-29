# Incident runbook

Use this runbook for the local first-vertical workflow. Preserve evidence, keep raw secrets out of notes, and use safe workflow IDs, property IDs, dates, and failure categories when communicating about an incident.

## AI provider failure

1. Confirm whether `AI_PROVIDER=stub` or `AI_PROVIDER=openai` is active.
2. Check worker logs and optional Sentry for the safe `provider` failure category.
3. For OpenAI, verify the local key and model configuration without printing the key.
4. Inspect the workflow in Temporal UI; temporary provider failures retry automatically.
5. If retries exhaust, the request becomes safely `failed` and no recommendation is persisted. Restore the dependency, then start a new request with an appropriate new date or investigate the existing idempotent request.

## Temporal workflow failure

1. Confirm `docker compose ps` shows Temporal healthy and the worker process is running on the configured task queue.
2. Search the workflow ID in Temporal UI and identify the failed activity category.
3. Check PostgreSQL availability through `/health`.
4. Restart only the affected local process or container; do not remove volumes for routine recovery.
5. Verify a fresh request completes and the dashboard’s failure count stabilizes.

## Validation-rejection spike

1. Compare rejection counts and issue codes on the dashboard and in safe logs.
2. Determine whether failures are malformed metadata, a provider regression, or a deliberate policy change.
3. Keep validation enabled; do not bypass it to make recommendations appear.
4. Switch to the deterministic stub to isolate provider behavior if needed.
5. Add or update a regression eval before changing a policy or provider adapter.

## Cost above threshold

1. Check dashboard cost totals and AI-call metrics by model and prompt version.
2. Confirm whether retries or a model change increased calls or token use.
3. Prefer the stub for local demos and lower-cost supported models for suitable production paths.
4. Pause nonessential generation while investigating; do not silently discard metrics.
5. Update the versioned pricing table and cost documentation if provider pricing changed.

## Latency increase

1. Compare successful AI latency with workflow and dependency health.
2. Inspect Temporal history for retries or activity delays.
3. Check database health and provider status separately.
4. Use the stub path to distinguish provider latency from workflow/database latency.
5. Record the hypothesis, evidence, and the regression check that confirms recovery.
