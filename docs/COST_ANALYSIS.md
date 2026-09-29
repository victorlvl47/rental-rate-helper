# Cost model

## Estimation

Each provider attempt records the model, prompt version, input tokens, output tokens, estimated USD cost, latency, and success state. OpenAI estimates come from the checked-in versioned table in `packages/pricing/src/model-pricing.ts`. Unknown models or missing usage produce `null`, never an invented cost.

The local stub intentionally reports no token use and no estimated cost. It is the preferred provider for repeatable local demos and automated verification.

## Reading dashboard cost

Dashboard total estimated AI cost is the sum of all stored provider attempts with known costs, including failed and retried calls. This makes retry-driven spend visible. Average AI latency uses successful attempts only. Validation rejections remain separate from workflow failures.

## Cost per recommendation

For a provider-backed result, cost per completed recommendation is the successful attempt plus any preceding failed/retried attempts associated with that request. The metric is therefore operationally honest: it reflects what the system spent to obtain the durable outcome, not just the final successful response.

## Model selection

Use a lower-cost model when structured explanation quality remains acceptable under the eval suite. Use a stronger model only when measured explanation quality or risk reasoning justifies the additional cost. The deterministic engine and validator remain authoritative regardless of model choice.

## Guardrails for future integrations

- Keep the stub path for local development and regression tests.
- Version the prompt and pricing table whenever they change.
- Monitor retries, token volume, cost per accepted recommendation, and model distribution.
- Add per-request, per-tenant, and budget thresholds before introducing real customer traffic.
- Treat unknown pricing as unavailable rather than estimating from memory.
