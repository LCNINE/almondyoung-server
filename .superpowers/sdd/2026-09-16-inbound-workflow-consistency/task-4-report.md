# Task 4 report — authoritative receipt state and origin candidates

## Implementation

- Added `ReceiptLineState` (the exact 19-field section 5.1 contract), `ReceiptActionBlockReason`, pure `receiptActionPolicy`, and a legacy history cancellation-reason mapper.
- Added `GET /inbound/lines/:lineId/state?warehouseId=<uuid>` and `InboundReceiptStateReader.getLineState(params, tx?)`. The route requires `inventory.operate`, validates both UUIDs, and the reader compares the actual receipt warehouse (403), distinguishes missing lines (404), and reads canceled/voided lines without needing receiptId. The existing authorization model has no additional actor-specific warehouse ACL; none was invented.
- Shared `receiptFactsCtes` aggregates receipt claims once per selected SKU/warehouse/origin grain, including competing receipts outside the selected page, and joins raw ON_HAND plus active/recovery-required custody. It reuses Task3 `inboundPendingQuantitySql` and `inboundReceiptInvalidSql` with their documented aliases.
- State, pending, and history each execute **one SQL statement** for their entire projection. History header page/total and line data also share that statement snapshot. Caller-owned READ COMMITTED transactions stay caller-owned; no new transaction isolation settings, locks, writes, or claims are introduced by these readers.
- Policy priority follows the full section 5.1 table. It handles cancellation/voiding, missing or wrong-warehouse origin / missing RECEIVE event, malformed counters, insufficient shared origin protection, staging eligibility, remaining quantity, prior putaway/return, and Seoul same-day cancellation. Shelf cancellation checks free stock without consuming another receipt claim or custody.
- History retains existing field names, date serialization, header total/page/SKU behavior, and old reason enum through the mapper. The intentional priority change makes a missing-origin old receipt report `MISSING_ORIGIN_OR_EVENT` instead of `NOT_TODAY`.
- Pending adds `source`, `canPutaway`, and `putawayBlockReason`; adds optional `originLocationId` filtering before LIMIT and to cursor scope; retains the 200-item bound, PostgreSQL microsecond cursor precision, and fixed rolling-days cutoff.
- Missing/zero ledgers and invalid legacy receipt counters/origins remain visible. Quantities are never clamped. Root-approved contract detail: pending `originLocationId` and `originLocationCode` are nullable for missing-origin legacy rows; those rows are blocked with `MISSING_ORIGIN_OR_EVENT`, with no manufactured origin.
- Registered the new reader and updated Nest test providers. Existing movement replay fixtures now create ordinary shelf stock; they retain the exact v2 key/body/actor/replay assertions and do not bypass inbound protection.

## RED / GREEN evidence

- Policy test first failed on missing `inbound-receipt-policy` module. State PostgreSQL test first failed on missing `inbound-receipt-state.reader` module. These runs are in the task tool transcript.
- Policy priority suite then passed 18 cases. Initial state PostgreSQL suite passed 4 cases.
- Controller tests first failed with missing `getReceiptLineState` and missing origin validation; then passed 47 cases (`/tmp/task4-controller.log`).
- Initial history/pending regression run had two expected contract differences: old zero-ledger rows became visible, and missing-origin priority overtook the date reason. Expectations were updated to the approved contract.
- Expanded tests caught fixture-only enum errors (`outbound_rework` system role and `individual` picking method), corrected before final verification.
- The seven-suite regression run exposed two existing movement replay fixtures that moved protected staging receipts. Corrected those fixtures to use direct shelf arrival; replay behavior remains unchanged.

## Verification commands

Runtime: Node 22, `corepack yarn`; database: dedicated migrated `inbound_workflow_consistency_test` on localhost. No credentials are recorded here.

Final focused tests:

```bash
corepack yarn test --runInBand --runTestsByPath \
  apps/core/src/modules/inventory/inbound/services/inbound-receipt-policy.spec.ts \
  apps/core/src/modules/inventory/inbound/services/inbound-receipt-state.integration.spec.ts \
  apps/core/src/modules/inventory/inbound/services/inbound-receipt-history.integration.spec.ts \
  apps/core/src/modules/inventory/inbound/services/inbound-putaway.reader.integration.spec.ts \
  apps/core/src/modules/inventory/inbound/controllers/inbound.controllers.spec.ts \
  apps/core/src/modules/inventory/core/controllers/warehouse-operation-auth.spec.ts \
  apps/core/src/modules/inventory/core/services/inventory-idempotency.integration.spec.ts
```

`DATABASE_URL` is set explicitly for that command. Final log: `/tmp/task4-green.log`. **PASS: 7 suites, 139 tests, exit 0, 19.126s.**

- `corepack yarn prettier --check` on all 15 changed TypeScript files: PASS, exit 0 (`/tmp/task4-format.log`).
- `git diff --check`: PASS.
- Existing auth failure-path tests intentionally log denied authorization lookup errors; all their assertions pass.

- `corepack yarn tsc --noEmit --incremental false -p apps/core/tsconfig.app.json`: PASS, exit 0, 49.73s (`/tmp/task4-tsc.log`). Later edits were fixture changes, formatting, and unused import cleanup.
- Scoped `corepack yarn eslint --fix` formatted all 15 changed TypeScript files. New errors and pre-existing unsafe HTTP test typing were corrected. Residual lint output consists solely of two **pre-existing unused optional `tx` parameters** in `InboundService.listInboundWorkLogs` / `listInboundStatus`, outside this task's read paths. They remain unchanged to avoid altering unrelated transaction behavior. Log `/tmp/task4-eslint-final.log` records those parameters during a temporary underscore rename; the original parameter names were restored afterward.

## Behavior coverage

- Canceled PO line lookup without receiptId, exact state response fields, original quantity/counters retained.
- Real Nest ScopeGuard plus actual PostgreSQL reader: anonymous / insufficient scope 403; actual wrong warehouse 403; malformed/missing/repeated UUID input 400; missing line 404; canceled PO line 200.
- Missing ledger across multiple receipt claims, all three individual negative counters, nonpositive quantity, excessive counters, null origin/event, and cross-warehouse origins; raw pending remains visible and unclamped.
- Ordinary shelf arrival remains cancelable; actual kernel cancellation succeeds. Shelf arrivals are not pending candidates.
- Custody plus multiple receipt sources: each projection detects overlap; increasing physical ledger to include custody allows both actions. A real Drizzle query logger verifies exactly one statement per state, pending, and history read.
- Two independent PostgreSQL connections: actual kernel putaway6/cancel10 is held before commit while all three readers see the complete pre-write state; after commit they see complete counters/ledger/header outcomes. Explicit barriers, no production test hooks, fixtures cleaned up afterward.
- 201 blocked candidates paginate 200+1, origin filtering occurs before LIMIT, another origin's receipt beyond the unfiltered page is found, and cursors cannot be mixed with another or absent origin scope. Existing tests retain microsecond ties, fixed-since scope, old receipts, SKU filters and all history compatibility checks.

## Concerns / limits

- No dependency, table, migration, persistent inventory copy, command authorization bypass, frontend implementation or capability rollout.
- Read policy describes current facts; existing write commands still validate under locks. Operational data reconciliation is outside this task.
- Downstream frontend parsers must accept nullable pending origin fields for blocked rows and require a real origin for actionable PutawayTarget selection (root ruling).
- Full repository verification and physical-device acceptance remain root-owned; no device acceptance is claimed.
