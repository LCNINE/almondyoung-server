# Single transaction runner (DbService.run) supersedes per-class inTx

## Status
Accepted (2026-06-28). Supersedes the per-class transaction-helper convention recorded in CLAUDE.md's "Inventory Transaction Propagation" section, which predates the WMS–PIM merge.

## Context
`apps/core` is a single app with one `DbService` over `mergedSchema` (one postgres connection, registered once in `app.module.ts` as `global`). `@InjectDb()` and `@InjectTypedDb<S>()` both resolve to that single instance — the per-`S` generic is a compile-time view only.

Before this ADR, ~60 service classes each redefined an identical helper:
```ts
private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx) {
  return tx ? fn(tx) : this.db.transaction(fn);
}
```
and the per-BC transaction type was derived three different ways (`DbTx = TxFor<…>`, `DbTransaction = PostgresJsDatabase<PimSchema>` as a *whole-db* type, file-local `type Tx = Parameters<…>`). Because every per-BC type describes the *same* physical transaction object typed against a partial schema, a transaction crossing a BC boundary could not unify, forcing `asTx(tx as unknown)` casts at the seams.

## Decision
- `@app/db` exposes three primitives:
  - `TxFor<S>` — the one canonical tx-type derivation (`Parameters<Parameters<PostgresJsDatabase<S>['transaction']>[0]>[0]`).
  - `AnyTx` — the one sanctioned wide tx type for cross-BC seam services (a structural `{ select; insert; update; delete; execute }`).
  - `DbService.run<T>(fn, tx?)` — the single transaction runner (`tx ? fn(tx) : this._db.transaction(fn)`).
- Per-BC tx types are derived only via `TxFor<S>` and keep their BC name: `DbTx = TxFor<typeof wmsSchema>` (inventory), `DbTransaction = TxFor<PimSchema>` (catalog), platform `DbTx = TxFor<MergedSchema>`, library `LibraryTx = TxFor<LibrarySchema>`, CS `CsTx = TxFor<MergedSchema>`.
- Within-BC services keep their narrow `DbService<S>` injection (the compile-time per-BC table-access guardrail — load-bearing for the 100+ `db.query.*` relational call sites) and call `this.<dbField>.run(fn, tx)`. The `tx?: <BcTx>` last-parameter propagation convention is retained; private helpers keep `tx: <BcTx>` required.
- Genuine cross-schema **seam** services declare the wider schema (`DbService<MergedSchema>` / `DbService<LibrarySchema>`) and accept `tx?: AnyTx`, performing one `tx as TxFor<TheirSchema>` narrowing where they run their own work. `DbService<MergedSchema>` is therefore the marker of a service permitted to cross BCs, and is expected to remain a short, reviewable list (currently: `ProductSellableQuantityService` — the canonical catalog↔inventory seam — plus the customer-service services, which are MergedSchema-typed but operate only on CS tables).
- Catalog's `DbTransaction` was narrowed from the whole-db `PostgresJsDatabase<PimSchema>` to `TxFor<PimSchema>`. The pervasive read-handle idiom `getClient(tx?) => tx ?? this.db.db` (which legitimately holds *either* a transaction *or* the base connection) is served by a separate `DbClient = DbTransaction | PostgresJsDatabase<PimSchema>` union type, since a `PgTransaction` is not assignable to a `PostgresJsDatabase`.

## Consequences
- The ~60 duplicated `inTx` helpers and the scattered `asTx`/`as unknown as DbTx` casts are removed. Verified: `grep "private async inTx<T>"` and `grep "asTx\|as unknown as DbTx\|tx?: unknown"` over `apps/core/src` (excluding specs) return nothing.
- Full static type safety across BC boundaries is intentionally **not** achieved; the per-BC guardrail is kept and the residual cross-BC narrowing is concentrated to the few seam services. This trade (guardrail over zero-cast) was chosen deliberately because the guardrail is load-bearing and the cast set is small.
- The "BC writes only its own tables" rule remains enforced by the per-BC `DbService<S>` typing plus review.

## Follow-ups (out of scope for this ADR's migration)
- **Remaining direct `.transaction()` calls.** This migration targeted the per-class `inTx` helpers and `asTx` casts only. A separate category of direct `this.db.transaction(...)` / `this.db.db.transaction(...)` calls remains in ~11 core files and could be converted to `DbService.run` for full consistency. Some of these should **stay** as direct calls: the outbox internals (`*/outbox/outbox.service.ts`, `outbox-dispatcher.service.ts`), the `inventory/shared/services/transaction.service.ts` utility, and `product-bulk.service.ts::bulkActivate`'s deliberate per-master **savepoint** (`tx.transaction(run)` under an outer tx, so a failed master rolls back without aborting the batch). Others are mechanical conversions deferred only to avoid scope creep: `sales-order/services/store-return-exchange.service.ts` (15 sites — also needs its structural `{ db: PostgresJsDatabase }` injection changed to `DbService<…>` first), the `fulfillment-order-creation-backlog` worker/service `claimPending` path, and `inventory/core/services/location.service.ts`.
- **Pre-existing latent bug (not introduced here).** `inventory/core/services/location.service.ts::getLocationById` reads via `this.db` instead of the `tx` callback parameter inside its `run` lambda, so the read escapes the surrounding transaction. This predates the refactor (the same `this.db` was used inside the old `inTx`). It should be fixed by routing the read through the lambda's `trx`.
- Optionally narrow the customer-service services from `DbService<MergedSchema>` to `DbService<CustomerServiceSchema>` so the `DbService<MergedSchema>` seam list shrinks to only genuine cross-BC seams.
- Adopting `DbService.run` in the other apps (analytics, ugc-service, user-service, wallet, outbox-demo), which still define their own per-class `inTx`, is a separate follow-up.
