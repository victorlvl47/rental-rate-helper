# Shared contracts

`packages/shared` defines RentalRateHelper's public runtime validation contracts
and inferred TypeScript types.

## Money boundary

Epic 2 price fields are USD JSON numbers and are validated by the shared Zod
schemas. PostgreSQL `numeric(10,2)` values may be returned by Drizzle as
strings. Database-layer code must explicitly convert those strings to JavaScript
numbers and validate the converted values with these schemas before returning
them in API JSON. PostgreSQL numeric strings must not leak into the public API
contract.
