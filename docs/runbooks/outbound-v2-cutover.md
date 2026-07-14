# Outbound V2 hard-cutover runbook

This runbook removes V1 fulfillment work data while preserving sales orders, master data, and the stock journal/event/ledger.
It is a maintenance-window procedure, not an online migration. Never use it to convert or drain individual V1 rows.

## Safety boundary

The toolkit deletes only the audited allowlist:

- all `fulfillment_order_creation_backlogs`
- only `stock_reservations` where `lower(target_type) = 'fulfillment_order'`
- V1 `shipment_tracking`, `inspection_issues`, `invoices`, `shipment_lines`, and `shipments`
- V1 `fulfillment_order_batches`, `fulfillment_order_items`, `fulfillment_orders`, and `outbound_batches`
- all `pending` or `failed` fulfillment/shipment-family `outbox_events` that the shared dispatcher could replay,
  including alternate legacy aggregate spellings and rows with a stale `published_at`

It does not delete sales orders/lines, SKU/warehouse/location master data, stock journals/events/ledgers, audit logs,
processed order-event tombstones, non-FO reservations, or unrelated outbox rows. The cleanup has no `TRUNCATE` or
`CASCADE`; it uses ordered `DELETE` statements in one serializable transaction.

The following conditions stop cleanup:

- a shipment-linked `SHIPMENT` journal or `SHIP` event exists;
- a non-allowlisted row has a live FK to a cleanup row (for example, a return linked to a V1 shipment);
- an `ORDER_CREATED` tombstone has a missing or invalid domain `payload.createdAt`;
- a V2-only table, V2 shipment status, or V2 shipment/fulfillment topic already contains a row;
- the database identity or audited cleanup-state hash has changed;
- the workflow is not in `maintenance`, the cutover timestamp differs, or the advisory lock is held;
- an affected stock grain is over-reserved or its event-derived balance differs from `stock_ledgers`.

Do not work around a blocker by deleting stock history, return history, audit rows, or another service's data. Stop the
cutover and perform a separate business/accounting review.

## Preconditions and evidence

Assign one operator to run commands and a second operator to review their output. Record all evidence in the release
ticket using immutable or access-controlled storage; do not commit audit artifacts or database credentials.

Before the window:

1. Run `DATABASE_URL=<isolated-postgres> yarn test:fulfillment-v2-cutover:integration`. This required suite fails instead
   of skipping when the database URL is absent and proves rollback, scope preservation, stale SHIP detection, and the
   pre-V2-row boundary against real PostgreSQL.
2. Deploy the V2 event contracts and the channel-adapter shipment/fulfillment-v2 consumers before any Core V2 producer.
   Confirm consumer groups are ready, have no schema errors, and can persist inbox events. Confirm legacy
   `FulfillmentShipped` no longer calls Naver or Coupang.
3. Deploy the Core build that supports `FULFILLMENT_WORKFLOW_MODE=maintenance|v2` while still in `legacy`. Confirm its
   startup log and health detail show the intended mode and watermark.
4. Pick one immutable ISO cutover timestamp. Use exactly the same `FULFILLMENT_V2_CUTOVER_AT` value for audit, cleanup,
   verification, and the V2 release.
5. Schedule a platform database snapshot and establish its retention/restore owner. A logical dump is not a substitute
   unless the platform restore procedure has been rehearsed.
6. Prepare a random secret of at least 32 bytes as `FULFILLMENT_V2_AUDIT_SIGNING_KEY`. Every cleanup with `--execute`
   rejects an unsigned artifact, regardless of `NODE_ENV`. Store the secret outside the repository and release logs.

## Enter maintenance

1. Stop upstream physical-order intake or activate the approved manual exception process. Maintenance keeps SO ingestion
   alive but deliberately does not backfill physical orders received during the window.
2. Set `FULFILLMENT_WORKFLOW_MODE=maintenance` on every Core worker/API instance and restart or roll out the setting.
3. Confirm all instances report maintenance mode and the same `FULFILLMENT_V2_CUTOVER_AT`.
4. Confirm FO backlog enqueue/claim, reservation retry, fulfillment mutation, picking, inspection, invoice, and dispatch
   work are stopped. General order ingestion and non-fulfillment outbox publication may remain active.
5. Wait for in-flight fulfillment DB transactions to finish. Do not wait for or publish legacy fulfillment outbox rows.

Example shell setup (values are examples only):

```bash
export DATABASE_URL='postgresql://.../core'
export FULFILLMENT_WORKFLOW_MODE=maintenance
export FULFILLMENT_V2_CUTOVER_AT='2026-07-14T09:00:00+09:00'
export FULFILLMENT_V2_AUDIT_SIGNING_KEY='...secret from the approved secret store...'
export AUDIT_PATH='/secure/cutover/outbound-v2-audit.json'
```

## Audit and platform snapshot

Run the read-only audit:

```bash
yarn fulfillment:v2:audit --output "$AUDIT_PATH"
```

The command creates a new mode-`0600` file and refuses to overwrite an existing path. It prints the artifact SHA-256,
database identity, exact allowlisted counts, number of affected `(warehouseId, skuId)` grains, warnings, and blockers.
It still writes the evidence file when a data blocker is found, then exits with status 2. Preserve that failed audit for
the investigation and do not continue.

Review the JSON with the second operator:

- `integrity.signature` is present and the displayed hash matches the release ticket;
- `database`, `cutoverAt`, and the cleanup allowlist are correct;
- every count/status distribution and affected reservation quantity is understood;
- `shipEvidence.journals` and `shipEvidence.events` are both zero;
- `blockers` is empty;
- open shipments, issued/used invoices, inspection issues, and active batches are confirmed to be non-production work.

Now create the platform database snapshot. Record its immutable snapshot ID, creation time, database identity, the audit
SHA-256, and both operator approvals together. The audit contains an intentional snapshot-ID placeholder; the real ID is
passed to cleanup and printed in its evidence output, so the original signed audit file remains immutable.

```bash
export SNAPSHOT_ID='platform-snapshot-immutable-id'
```

## Dry-run and cleanup

The cleanup command is a dry-run unless `--execute` is present. Dry-run verifies the artifact hash/HMAC, exact toolkit
allowlist, database identity, live cleanup-state hash, snapshot ID, workflow mode, cutover timestamp, SHIP absence,
row-level FK closure, and advisory lock. Protected tables are fingerprinted immediately before and after the simulated
deletes. It executes the ordered cleanup and all post-delete reconciliation behind a savepoint, then rolls the savepoint
back so no rows change:

```bash
yarn fulfillment:v2:cleanup --audit "$AUDIT_PATH" --snapshot-id "$SNAPSHOT_ID"
```

If the live state no longer matches `auditStateHash`, make a new audit, review it, and create/link fresh snapshot evidence.
Do not edit and re-hash the old artifact.

After both operators approve the dry-run, execute exactly once:

```bash
yarn fulfillment:v2:cleanup --audit "$AUDIT_PATH" --snapshot-id "$SNAPSHOT_ID" --execute
```

The command takes `pg_try_advisory_xact_lock(hashtext('fulfillment-v2-hard-cutover/v1'))`, repeats the preflight inside a
serializable transaction, applies ordered deletes, fingerprints all protected tables before/after, and runs affected-stock
reconciliation before commit. Any error rolls back every delete. Save the JSON result with the snapshot and audit evidence.

## Verify and enable V2

Run verification while maintenance is still active:

```bash
yarn fulfillment:v2:verify --audit "$AUDIT_PATH"
```

All checks must be true:

- allowlisted V1 counts and confirmed FO reservations are zero;
- replayable legacy fulfillment/shipment outbox rows are zero;
- old `ORDER_CREATED` tombstones have valid domain time and no backlog/FO that can replay;
- affected reservation totals do not exceed `ON_HAND` ledger totals;
- affected stock-event derivation equals the stock ledger at every location/state grain;
- every V2-only table/status/topic is still empty before activation;
- no journal or SHIP event exists for any shipment ID preserved in the signed audit, even though shipment rows are gone.

Run verify a second time; it is read-only and idempotent. Attach both reports to the release ticket.

Then deploy/enable V2 Core with:

```text
FULFILLMENT_WORKFLOW_MODE=v2
FULFILLMENT_V2_CUTOVER_AT=<the exact audited timestamp>
```

Confirm all instances report `v2`, channel-adapter consumers remain ready, and the first post-watermark owned physical
order creates one FO plus its initial Draft shipment. Confirm a pre-watermark Kafka redelivery creates neither backlog nor
FO, while ownership self-healing may still run. Resume upstream intake only after these checks pass.

## Rollback and incident boundary

Before the first V2 row exists, stop the rollout, keep intake stopped, restore the recorded platform snapshot, and deploy
the prior release/mode according to the platform restore procedure. Verify the restored database identity and counts
against the signed audit evidence before resuming traffic.

After any V2 FO, shipment, reservation, invoice operation, work item, dispatch attempt, or V2 outbox row exists, do not
restore the V1 snapshot and do not switch mutation traffic back to V1. The rule is:

> V2 row exists -> stop intake and repair in V2.

Keep V2 code deployed, return all Core instances to a non-mutating maintenance state, preserve provider/inbox/outbox
evidence, and follow the V2 recovery/recall procedure for the affected operation. Snapshot restoration after this point
would discard legitimate V2 stock and channel progress.

## Exit checklist

- Release ticket contains audit file hash/HMAC status, snapshot ID, dry-run result, cleanup result, and two verify reports.
- No audit artifact, signing key, database URL, or production row dump is staged in Git.
- All Core instances have one mode and one cutover timestamp; no stale maintenance/legacy instance remains.
- Channel-adapter V2 consumers and inbox workers are healthy before Core producers emit events.
- Upstream intake resumes only after the first-order and pre-watermark-redelivery checks pass.
- The snapshot remains retained until the V2 observation-period/contract-migration gate is approved.
