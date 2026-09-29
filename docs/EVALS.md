# Evaluation methodology

RentalRateHelper evaluates a hybrid system whose pricing decision is deterministic. “Ground truth” therefore means the expected behavior of the pricing policy and validation contract, not a claim that a language model can discover a universally correct market price.

## What is evaluated

The checked-in cases cover realistic fake-rental scenarios:

- high demand or strong occupancy pressure increases price within policy limits;
- low occupancy or weak demand decreases price;
- local events and competitor prices influence the deterministic result;
- property minimum and maximum prices constrain the safe range;
- malformed or mismatched AI metadata is rejected;
- confidence, risk, explanation, and schema rules are enforced.

The deterministic engine has a 30% maximum increase cap. This matches the validator so an otherwise valid workflow does not create and reject its own authoritative result.

## Run the offline suite

```bash
pnpm --filter api eval:pricing
```

The suite uses static in-memory fixtures. It needs no database, Temporal service, provider key, or network request. It prints one deterministic `PASS` or `FAIL` line for each case and returns a non-zero exit code on failure.

## Workflow verification

The Temporal integration suite verifies the real local workflow boundary: retry recovery and exhaustion, idempotent starts, missing properties, invalid AI output, accepted results, safe failure storage, and the accepted 30% cap boundary.

```bash
pnpm infra:up
pnpm --filter database db:migrate
pnpm --filter database db:seed
pnpm --filter worker test:temporal-retry
```

## Handling failed evaluations

A failed evaluation is evidence to investigate, not a reason to loosen assertions. First classify whether it is a policy decision, deterministic-calculation defect, validation defect, provider-contract issue, or test-fixture error. Update the policy and its tests together when the business rule intentionally changes. Do not change expected results merely to make an unrelated implementation pass.
