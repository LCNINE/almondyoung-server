# Task 2 report

## Result

Implemented the purchase-order status and settlement pure functions, moved header expected-arrival derivation into the procurement status rules, removed the obsolete closure rules, and retained the shared `earliestExpectedDate` helper.

## TDD evidence

RED command:

```text
npx jest apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules
```

Result: failed as expected before production implementation:

```text
Cannot find module './purchase-order-status.rules' from 'apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules.spec.ts'
Test Suites: 1 failed, 1 total
Tests:       0 total
```

GREEN command:

```text
npx jest apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules
```

Result:

```text
PASS apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules.spec.ts
Test Suites: 1 passed, 1 total
Tests:       18 passed, 18 total
```

Additional validation:

```text
npx prettier --check apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules.ts apps/core/src/modules/inventory/procurement/services/purchase-order-status.rules.spec.ts apps/core/src/modules/inventory/shared/dates/earliest-expected-date.ts
Checking formatting...
All matched files use Prettier code style!
```

The mandated type-check was run with `npm run type-check 2>&1`; it exits 2 with 3 expected downstream diagnostics:

```text
apps/core/src/modules/inventory/procurement/services/purchase-order-closure.adapter.ts(5,35): error TS2307: Cannot find module './purchase-order-closure.rules' or its corresponding type declarations.
apps/core/src/modules/inventory/procurement/services/purchase-order.manager.ts(16,28): error TS2307: Cannot find module './purchase-order-closure.rules' or its corresponding type declarations.
apps/core/src/modules/inventory/procurement/services/purchase-order.reader.ts(9,10): error TS2305: Module '"../../shared/dates/earliest-expected-date"' has no exported member 'purchaseOrderExpectedArrival'.
```

## Self-review and concerns

- The status table is exhaustive over `PurchaseOrderStatus` and keeps `received` derivable so receipt cancellation can move a header back to `confirmed`.
- `outstandingQty` treats null `orderedQty` as zero and excludes closed or non-ordered lines.
- The type-check failures are the explicitly deferred Task 3 callers/import migration; no unrelated diagnostics appeared.
- No database, generator, integration suite, push, or PR operation was performed.
