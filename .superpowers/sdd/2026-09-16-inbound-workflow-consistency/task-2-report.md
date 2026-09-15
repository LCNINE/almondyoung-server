# Task 2 report — atomic inbound protection and kernel ordering

## Outcome

Implemented the pending-receipt protection boundary on the current feature branch. No new tables, stock states, DTO flags, transaction ownership changes, or procurement imports into the inbound kernel.

- `StockEventStore.applyProjection` checks the actual location-grained ON_HAND net decrease after acquiring the existing stock advisory locks. The shared Task 1 assertion runs for projection paths regardless of dispatch authorization. Same-grain net-zero projections are excluded.
- The pre-existing new-event and reversal custody guards now use the same net-decrease predicate. Successful event replay still returns before availability/projection checks.
- `BatchControlledStockGuard` exposes `inboundPendingQty`; free quantity subtracts both pending and active custody. Invalid receipts or protection above on-hand return `INBOUND_ORIGIN_STOCK_INCONSISTENT`. Pending-related denial returns `INBOUND_ORIGIN_STOCK_PROTECTED`; custody-only denial preserves `BATCH_CONTROLLED_STOCK`.
- Kernel putaway, return and cancel acquire stock availability locks and validate the original pending/custody state before releasing counters. Each counter is saved exactly once from the locked original line before its ledger mutation. Work logs and receipt/header updates stay in the caller transaction.
- Cancel locks the original event before acquiring stock locks, preserving reversal's event → stock order and existing document → receipt lock order. The shared guard performs ordinary receipt SELECTs, not receipt row locks.
- Putaway rejects same-origin and system destinations with `INBOUND_PUTAWAY_DESTINATION_INVALID`.
- The shared test wiring now builds the real movement service and exposes its real dependency assembly. No guard mocks or production test bypasses were added.

## TDD and verification evidence

### RED

Ran the new protection suite before production edits. After correcting a fixture sort to use stock_ledgers' composite grain, the actual `MovementService.moveImmediately` reproduced the original bug: receive 10 → general move 6 resolved successfully while the test expected `INBOUND_ORIGIN_STOCK_PROTECTED`. Other tested command paths likewise lacked pending protection, and availability reported all 12 units free instead of 2 for on-hand 12 / pending 10.

Raw transient evidence: `/tmp/task2-red.log`. Initial test authoring also exposed two fixture mistakes (a nonexistent `DEFECT` enum instead of `DEFECTIVE`, and a same-grain event disallowed by the existing DB constraint); those were corrected rather than changing production schema.

### GREEN

Dedicated migrated PostgreSQL DB: `inbound_workflow_consistency_test` at local port 5432. Every integration run set DATABASE_URL; no database-gated tests were skipped.

Final required command:

```bash
corepack yarn test --runInBand --runTestsByPath \
  apps/core/src/modules/inventory/core/services/inbound-origin-protection.integration.spec.ts \
  apps/core/src/modules/inventory/core/services/inbound-origin-protection.concurrency.integration.spec.ts \
  apps/core/src/modules/inventory/inbound/kernel/inbound-receipt.kernel.integration.spec.ts \
  apps/core/src/modules/inventory/procurement/services/purchase-order-receiving.integration.spec.ts \
  apps/core/src/modules/inventory/core/services/batch-controlled-stock.guard.integration.spec.ts
```

Result: **5 suites, 65 tests passed, 0 skipped**, exit 0. Log: `/tmp/task2-required-tests.log`.

Additional focused regression run (before the final two added tests): the same five suites plus `inbound-putaway.reader.integration.spec.ts` and `inbound.service.arrival-characterization.integration.spec.ts`: **7 suites, 90 tests passed, 0 skipped**, exit 0. Log: `/tmp/task2-final-tests.log`.

`corepack yarn tsc --noEmit --incremental false`: exit 0 after correcting helper-related nullability and a test callback union. Log: `/tmp/task2-tsc2.log`. This ran before the last two test-only additions; production code was unchanged afterward. The final additions passed Jest in the required run.

Prettier applied only to changed TypeScript files. `git diff --check`: clean.

## Coverage

- Actual InboundService receive → actual MovementService general movement rejects; full ledger/event/receipt/counter/work-log/movement-job snapshots are unchanged.
- Real command paths: adjustDown, transferShip, ship; real StocktakingService.completeSession physical-count decrease; RECEIVE reversal; state transition; direct StockEventStore.createEvent.
- Direct projection net-decrease assertion independently verifies the final guard instead of relying solely on earlier command/custody guards.
- Same-grain ON_HAND projection leaves physical and pending amounts unchanged.
- Selected-line putaway with a same-SKU PO sibling, subsequent shelf movement, remaining putaway and new arrival preserve the expected per-line counters and origin pending sum.
- On-hand 12 / pending 10 exposes and permits only free 2. Exact successful event replay does not recheck now-depleted free quantity.
- Real authorized dispatch with pending receipts preserves the pending quantity and replays successfully; a historical custody+pending overlap rejects even though on-hand covers pending alone.
- Existing custody-only denial and authorization regression coverage remains green.
- Mixed pending+custody free availability; allowed free movement; normal return; invalid overlapping protection rejected.
- Putaway/return/cancel reject historical origin insufficiency before releasing counters.
- PostgreSQL trigger-injected ledger and work-log failures for each of putaway, return and cancel roll back all ledger/event/counter/history/header writes.
- A real reservation invariant denial during cancellation (after provisional counter release) rolls back the caller savepoint and preserves receipt, counter, stock, event and work-log snapshots.
- Real PO receive and cancel service path with SQL-triggered purchase-order settlement failure rolls back cancellation, origin ledger, counters, work logs, PO header and received/outstanding amounts.
- Ordinary shelf direct arrival remains cancelable.

### Concurrency

Six cases use two independent worker connections, a separate observer connection, deferred barriers, observed PostgreSQL blocking (`pg_blocking_pids`) and an explicit assertion that worker B has not completed before release:

1. move → putaway
2. putaway → move
3. move → arrival
4. arrival → move
5. cancel → RECEIVE reversal
6. RECEIVE reversal → cancel

The reversal-first case pauses while holding the original event **before** the reversal acquires stock; cancellation waits on that event. Resuming reversal would deadlock with an incorrect stock → event cancellation order. Final checks include origin/shelf quantity, pending amount, original line counters, event count, work-log count/types and no movement job. All connections close in finally blocks, with committed fixtures removed.

The move in concurrency cases requests 1 so that, after a 6-unit putaway leaves 4, rejection reaches pending protection rather than the existing physical-insufficiency precheck. The standalone original reproduction still uses move 6 from receipt 10.

## Scope notes and follow-up handoff

- Existing `ck_events_states_diff` forbids public same-grain events. The net-zero projection regression therefore calls the private projection method through narrow test access. Schema was preserved; the production net-decrease helper is private to its module and used by three production checks.
- One pre-existing putaway reader test used a real general movement to manufacture corrupted legacy data. That setup now explicitly injects historical ledger corruption; its current reader expectation is preserved. **Task 4** changes zero/missing-origin visibility to an explicit inconsistent row. This is the only extra existing test file changed beyond the brief's file list and the relevant custody spec.
- Putaway ↔ session acquisition races and session acquisition behavior belong to the subsequent task; this task preserves and tests the dispatch boundary.
- No operational data repair or deployment validation was attempted.
