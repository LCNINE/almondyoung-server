# Missing product matchings

Run from the repository root against exactly one tenant's core database. No environment files,
tenant defaults, AWS discovery or service bootstrap are used.

```sh
DATABASE_URL='<one-tenant-core-postgresql-url>' DRY_RUN=1 npx tsx scripts/ops/backfill-missing-product-matchings.ts
DATABASE_URL='<one-tenant-core-postgresql-url>' DRY_RUN=0 npx tsx scripts/ops/backfill-missing-product-matchings.ts --apply
```

The default is read-only. `--apply` is required to write; `DRY_RUN=1 --apply` is rejected.
Review the counts by variant creation week, version status and selection partition first.
Each group includes the number of variants on orders with an `awaiting_matching` backlog.
Version-status groups overlap when a variant belongs to multiple versions; other groups do not.

Only active variants belonging to a non-deleted active version and non-deleted master are inserted.
Draft-only, inactive-only, deleted and ambiguous-master variants are reported but excluded, even if
they have waiting orders. Those require a separate operator decision. Unattached variants are excluded.
Each variant is rechecked under the application's advisory lock in its own transaction;
`ON CONFLICT (variant_id) DO NOTHING` preserves concurrently created rows. Earlier transactions remain
committed if a later one fails; rerunning is safe.

The insert matches `handleManualMatchingRequest`: pending, high priority, null strategy, unresolved,
with a master ID and database defaults for other fields (including `pre_stock_sellable=true`).
Product creation always passes `inventoryManagement=true`, so this does not infer auto-void from
`sales_variant_policies`. The auto-void branch only applies to an explicitly false creation payload.

Core computes zero/non-sellable for both `MATCHING_MISSING` and `MATCHING_PENDING`, but the shared
Medusa projection policy treats both as non-stock-gated (`manage_inventory=false`). Creating pending
rows therefore does not turn currently purchasable variants into sold-out variants. Manual sold-out
and coming-soon overrides still take precedence. The spec checks these three cases against the
production calculator and projection policy.

This repair intentionally inserts only the missing matching rows: it does not recalculate/publish
sellable quantities, overwrite cached projections, change stock policies or bootstrap Nest (which
would start unrelated infrastructure). Cached matching IDs/reasons remain unchanged until the normal
recalculation path runs. This also preserves existing storefront projections, including stale ones.
`/order/matching` reads the new matching ID directly. Pending alone cannot satisfy fulfillment, so no
backlogs are woken here; resolving the matching through the normal admin flow recalculates/publishes
availability and wakes the waiting backlog. Review SKU and stock policies when resolving.
