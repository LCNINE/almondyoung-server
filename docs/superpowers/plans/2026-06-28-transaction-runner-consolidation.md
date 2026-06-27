# Transaction Runner Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ~60 copy-pasted per-class `inTx` transaction helpers in `apps/core` with a single `DbService.run` runner and a single canonical per-BC transaction type derivation, eliminating the scattered `asTx(tx as unknown)` casts while preserving the per-BC compile-time table-access guardrail.

**Architecture:** Add three primitives to `@app/db` — `TxFor<S>` (one canonical tx-type derivation), `AnyTx` (one sanctioned wide tx type for cross-BC seams), and `DbService.run<T>(fn, tx?)` (the single transaction runner). Within-BC services keep their narrow schema typing (`DbService<typeof wmsSchema>` etc., guardrail intact) and just swap their local `inTx` body for `this.<dbField>.run`. The few genuine cross-schema seam services (where a transaction crosses from one BC's schema-view to another) declare the wider schema and accept `tx?: AnyTx`, performing the single sanctioned narrowing cast in one place. The DbService generic now *documents* a service's blast radius: `grep "DbService<MergedSchema>"` lists every service allowed to cross BCs.

**Tech Stack:** NestJS, Drizzle ORM (`drizzle-orm/postgres-js`), TypeScript, Jest (ts-jest). Monorepo with `@app/db` shared library.

---

## Background facts (verified)

- `@app/db` (`libs/db/src/`): `DbService<TSchema extends DrizzleSchema>` holds private `_db: PostgresJsDatabase<TSchema>` and exposes `get db()`. `types.ts` already exports `DrizzleSchema` and `TypedDatabase<S> = PostgresJsDatabase<S>`. `index.ts` re-exports `db.module`, `db.service`, `types`, `decorators`.
- Core registers **one** `DbService` (`app.module.ts:29`, `DbModule.forRootAsync`, `global: true`) over `mergedSchema` (`apps/core/src/platform/database/merged-schema.ts` = `{...catalogSchema, ...inventorySchema, ...librarySchema, ...customerServiceSchema}`). `@InjectDb()` and `@InjectTypedDb<S>()` both resolve to that single instance — the per-`S` generic is a compile-time view only.
- Per-BC schema **types** already exist: `PimSchema` (= `CatalogSchema`, `apps/core/src/modules/catalog/schema/catalog.schema.ts:1138`), `InventorySchema` (= `typeof wmsSchema`, `inventory.schema.ts:3426`), `LibrarySchema` (`library.schema.ts:178`), `CustomerServiceSchema` (`customer-service.schema.ts:153`), `MergedSchema` (`apps/core/src/platform/database/merged-schema.ts`).
- Per-BC tx **types** are inconsistent today (the thing we standardize):
  - inventory: `DbTx = Parameters<Parameters<TypedDatabase<typeof wmsSchema>['transaction']>[0]>[0]` (`inventory.schema.ts:3185`).
  - catalog: `DbTransaction = PostgresJsDatabase<PimSchema>` (`catalog.types.ts:40`) — **whole-db form, the outlier**.
  - library/customer-service: file-local `type Tx = Parameters<...>` (not exported).
  - platform: `DbTx = Parameters<Parameters<AppDb['transaction']>[0]>[0]` (`platform/database/types.ts:8`).
  - sellable-quantity: file-local `ProductSellableQuantityDbTx = Parameters<...TypedDatabase<MergedSchema>...>` + `asTx(tx as unknown)` (`product-sellable-quantity.service.ts:22,46`).
  - library/variant-asset-link: file-local `type AnyTx = { insert: any; select: any; delete: any; update: any }` (`variant-asset-link.service.ts:25`).
- Verification: `npm run build:core` (= `nest build core`) is the typecheck gate. Targeted tests via `npx jest --testPathPattern=<pattern>`. **Never run the full jest suite — it OOMs.** `@app/db` additions are purely additive, so other apps' builds are unaffected (core-first scope).

## File Structure

**New / modified primitives (`@app/db`):**
- Modify `libs/db/src/types.ts` — add `TxFor<S>` and `AnyTx`.
- Modify `libs/db/src/db.service.ts` — add `run<T>(fn, tx?)`.
- Create `libs/db/src/db.service.spec.ts` — unit test for `run`.

**Canonical tx-type homes (re-expressed via `TxFor`, names kept):**
- Modify `apps/core/src/modules/inventory/schema/inventory.schema.ts:3185` (`DbTx`).
- Modify `apps/core/src/modules/catalog/catalog.types.ts:40` (`DbTransaction`).
- Modify `apps/core/src/platform/database/types.ts:8` (`DbTx`).

**Cross-schema seam services (declare wider schema + `tx?: AnyTx`):**
- `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.ts`
- `apps/core/src/modules/library/services/variant-asset-link.service.ts`
- `apps/core/src/modules/fulfillment/services/direct-ship.service.ts` (cleanup `as unknown as DbTx`)
- `apps/core/src/modules/inventory/movement/services/movement.service.ts` (cleanup `as unknown as DbTx`)

**Within-BC mechanical sweep (recipe-applied, per BC):** all remaining `inTx`-defining core services in `catalog`, `inventory`, `fulfillment`, `sales-order`, `product-matching`, `library` (grant), `customer-service`.

**Docs:**
- Create `docs/adr/0025-single-transaction-runner.md`.
- Modify `CLAUDE.md` (Inventory Transaction Propagation section).

---

## Migration Recipe (within-BC services)

Apply this to each within-BC service that defines a local `inTx`. **It is purely mechanical and behaviour-preserving** (`tx ? fn(tx) : db.transaction(fn)` is unchanged — only its home moves to `DbService.run`).

1. Identify the injected `DbService` field — usually `this.dbService` (some files name it `this.db`). Call it `<dbField>` below.
2. Delete the local helper: the whole `private async inTx<T>(fn, tx?) { return tx ? fn(tx) : ...; }` block (and any `private get dbConn()` / `private get db()` getter that existed *only* to feed `inTx` — keep getters still used by direct `.select()` queries).
3. Replace every `return this.inTx(` / `await this.inTx(` call with `this.<dbField>.run(`. The callback and arguments are otherwise unchanged.
4. Keep the public-method signature convention: `tx?: <BcTx>` stays the last parameter; private helpers keep `tx: <BcTx>` required.
5. Keep the BC tx-type import (`DbTx` from inventory.schema, `DbTransaction` from catalog.types, etc.) — it is now the canonical `TxFor<...>` alias and still types the callback `trx` via inference.
6. If the file had a file-local `type Tx = Parameters<...>`, delete it and import the BC's exported tx type instead (`DbTx`/`DbTransaction`).

**Worked example** — `apps/core/src/modules/inventory/core/services/holder.service.ts`:

Before:
```ts
@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
// ...
private async inTx<T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> {
  return tx ? fn(tx) : this.dbService.db.transaction(fn);
}

async createHolder(dto: CreateHolderDto, tx?: DbTx) {
  return this.inTx(async (trx) => {
    // ... uses trx
  }, tx);
}
```

After:
```ts
@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
// ... (inTx block deleted)

async createHolder(dto: CreateHolderDto, tx?: DbTx) {
  return this.dbService.run(async (trx) => {
    // ... uses trx  (trx: DbTx inferred)
  }, tx);
}
```

**Verification after each BC batch:** `npm run build:core` must pass (this is the typecheck — it catches any missed `inTx` call, wrong field name, or type drift).

---

## Task 1: Add `TxFor` and `AnyTx` to `@app/db`

**Files:**
- Modify: `libs/db/src/types.ts`

- [ ] **Step 1: Add the two type primitives**

In `libs/db/src/types.ts`, after the existing `TypedDatabase` definition (line 10), add:

```ts
/**
 * Canonical transaction-handle type for a given schema.
 * The single sanctioned way to derive a per-BC tx type:
 *   export type WmsTx = TxFor<typeof wmsSchema>;
 */
export type TxFor<TSchema extends DrizzleSchema> = Parameters<
  Parameters<PostgresJsDatabase<TSchema>['transaction']>[0]
>[0];

/**
 * Wide transaction type for cross-BC seam services that must accept a
 * transaction opened under a different BC's schema view. This is the only
 * sanctioned `any` surface for transaction propagation — every per-BC
 * `TxFor<S>` is assignable to it. Seam services narrow it back with a single
 * `tx as TxFor<TheirSchema>` at the point they run their own work.
 */
export type AnyTx = { select: any; insert: any; update: any; delete: any; execute: any };
```

- [ ] **Step 2: Verify the library still type-checks**

Run: `npm run build:core`
Expected: PASS (additive change; nothing consumes the new types yet).

- [ ] **Step 3: Commit**

```bash
git add libs/db/src/types.ts
git commit -m "feat(db): add TxFor<S> and AnyTx transaction-type primitives"
```

---

## Task 2: Add `DbService.run` (TDD)

**Files:**
- Modify: `libs/db/src/db.service.ts`
- Test: `libs/db/src/db.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `libs/db/src/db.service.spec.ts`:

```ts
import { DbService } from './db.service';

describe('DbService.run', () => {
  function makeService(transaction: jest.Mock) {
    // Bypass the constructor (which opens a postgres client) — unit test the runner only.
    const service = Object.create(DbService.prototype) as DbService;
    (service as unknown as { _db: { transaction: jest.Mock } })._db = { transaction };
    return service;
  }

  it('runs fn with the provided tx and does NOT open a new transaction', async () => {
    const transaction = jest.fn();
    const service = makeService(transaction);
    const fn = jest.fn(async (tx: string) => `ran:${tx}`);

    const result = await service.run(fn as never, 'EXISTING_TX' as never);

    expect(result).toBe('ran:EXISTING_TX');
    expect(fn).toHaveBeenCalledWith('EXISTING_TX');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('opens a new transaction when no tx is provided', async () => {
    const transaction = jest.fn(async (fn: (tx: string) => Promise<unknown>) => fn('NEW_TX'));
    const service = makeService(transaction);
    const fn = jest.fn(async (tx: string) => `ran:${tx}`);

    const result = await service.run(fn as never);

    expect(result).toBe('ran:NEW_TX');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('NEW_TX');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPattern=libs/db/src/db.service.spec`
Expected: FAIL with "service.run is not a function".

- [ ] **Step 3: Implement `run`**

In `libs/db/src/db.service.ts`, change the `types` import (line 5) to also import `TxFor`:

```ts
import { DrizzleSchema, TxFor } from './types';
```

Then add this method inside the `DbService` class, after the `get db()` getter (line 38):

```ts
/**
 * Single transaction runner. If `tx` is provided, runs `fn` inside it
 * (propagation); otherwise opens a new transaction. Replaces the per-class
 * `inTx` helper. The callback's tx type is derived from this DbService's
 * schema (`TxFor<TSchema>`); cross-BC seam services inject a wider schema.
 */
async run<T>(fn: (tx: TxFor<TSchema>) => Promise<T>, tx?: TxFor<TSchema>): Promise<T> {
  return tx ? fn(tx) : this._db.transaction(fn);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --testPathPattern=libs/db/src/db.service.spec`
Expected: PASS (2 passing).

- [ ] **Step 5: Verify build**

Run: `npm run build:core`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/db/src/db.service.ts libs/db/src/db.service.spec.ts
git commit -m "feat(db): add DbService.run single transaction runner with unit test"
```

---

## Task 3: Normalize per-BC tx-type derivations via `TxFor`

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts:3185`
- Modify: `apps/core/src/modules/catalog/catalog.types.ts:40`
- Modify: `apps/core/src/platform/database/types.ts:8`

- [ ] **Step 1: Inventory — re-express `DbTx` via `TxFor` (name kept)**

In `inventory.schema.ts`, ensure `TxFor` is imported from `@app/db` and replace the `DbTx` export (line 3185):

```ts
import { TxFor } from '@app/db';
// ...
export type DbTx = TxFor<typeof wmsSchema>;
```

- [ ] **Step 2: Catalog — fix the outlier whole-db `DbTransaction` to the subtx form**

In `catalog.types.ts`, replace line 40:

```ts
import { TxFor } from '@app/db';
// ...
export type DbTransaction = TxFor<PimSchema>;
```

- [ ] **Step 3: Platform — re-express `DbTx` via `TxFor` (name kept)**

In `platform/database/types.ts`, replace line 8:

```ts
import { TxFor } from '@app/db';
// ...
export type DbTx = TxFor<MergedSchema>;
```

- [ ] **Step 4: Verify build**

Run: `npm run build:core`
Expected: PASS. (`TxFor<S>` is identical to the previous `Parameters<...>` derivation for inventory/platform; for catalog it narrows from whole-db to subtx, which is safe because no catalog code calls `.transaction()` on a `DbTransaction`-typed value — that role moves to `DbService.run`.)

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/src/modules/catalog/catalog.types.ts apps/core/src/platform/database/types.ts
git commit -m "refactor(core): derive per-BC tx types via TxFor; fix catalog DbTransaction outlier"
```

---

## Task 4: Cross-schema seam — `ProductSellableQuantityService`

This is the canonical seam: it is typed over `MergedSchema` and receives transactions from both catalog publish (`PimTx`) and inventory `stock-event.store` (`WmsTx`). Today it uses a file-local `ProductSellableQuantityDbTx` + `asTx(tx as unknown)`.

**Files:**
- Modify: `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.ts`

- [ ] **Step 1: Replace the local tx type, helper, and cast**

At the top of the file, delete the local type (line 22) and import the canonical types:

```ts
import { AnyTx, TxFor } from '@app/db';
import { MergedSchema } from '../../../../platform/database/merged-schema';
type MergedTx = TxFor<MergedSchema>;
```

Ensure the injected DbService is `DbService<MergedSchema>` (so `this.dbService.run`'s callback is `MergedTx`). Delete the `private async inTx<T>(...)` block (lines 39-48) and the `private asTx(...)` method (lines 46-48).

- [ ] **Step 2: Convert public methods to `AnyTx` + `run`**

For every public method that previously took `tx?: ProductSellableQuantityDbTx` (e.g. `getByVariantId`, `getByVariantIds`) or `tx?: unknown` (e.g. `recalculateAndPublishForSku`, `recalculateAndPublishForVariants`):

- Change the parameter to `tx?: AnyTx`.
- Replace `this.inTx(fn, this.asTx(tx))` / `this.inTx(fn, tx)` with:

```ts
return this.dbService.run(async (trx) => {
  // ... unchanged body, trx: MergedTx
}, tx as MergedTx | undefined);
```

(The `tx as MergedTx` is the single sanctioned cross-BC narrowing for this service.)

- [ ] **Step 3: Run the existing service tests**

Run: `npx jest --testPathPattern=product-sellable-quantity`
Expected: PASS (this service already has `.spec.ts` files covering the calculator and service; behaviour is unchanged).

- [ ] **Step 4: Verify build**

Run: `npm run build:core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.ts
git commit -m "refactor(inventory): sellable-quantity uses DbService.run + canonical AnyTx seam"
```

---

## Task 5: Cross-schema seam — `VariantAssetLinkService`

Library-typed service that receives catalog publish's `PimTx`. Already uses `tx?: AnyTx`, but with a *local* `AnyTx` and a local `type Tx` + local `inTx`.

**Files:**
- Modify: `apps/core/src/modules/library/services/variant-asset-link.service.ts`

- [ ] **Step 1: Replace local types with canonical ones**

Delete the file-local `type AnyTx = { ... }` (line 25) and the file-local `type Tx = Parameters<...>` (line 17). Add:

```ts
import { AnyTx, TxFor } from '@app/db';
import { type LibrarySchema } from '../schema/library.schema';
type LibraryTx = TxFor<LibrarySchema>;
```

Keep the injection `@InjectDb() private readonly dbService: DbService<LibrarySchema>` (this service only touches library tables — narrow typing stays).

- [ ] **Step 2: Delete `inTx`, route through `run`**

Delete the `private async inTx<T>(...)` block. In each method, replace `this.inTx(fn, tx)` with:

```ts
return this.dbService.run(async (trx) => {
  // ... unchanged body, trx: LibraryTx
}, tx as LibraryTx | undefined);
```

Public methods that accept a foreign tx (`listAssetsForVariant`, `inheritLinksFromTwins`, `cloneLinksForVariant`) keep `tx?: AnyTx` / `tx: AnyTx`. Private helpers that previously used `Tx` now use `LibraryTx`.

- [ ] **Step 3: Verify build**

Run: `npm run build:core`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/modules/library/services/variant-asset-link.service.ts
git commit -m "refactor(library): variant-asset-link uses canonical AnyTx + DbService.run"
```

---

## Task 6: Cleanup `as unknown as DbTx` casts — `direct-ship` and `movement`

These two `wmsSchema`-typed services currently hold `tx as unknown as DbTx` double-casts (the P3 symptom). After the runner exists they become plain within-`wmsSchema` calls.

**Files:**
- Modify: `apps/core/src/modules/fulfillment/services/direct-ship.service.ts`
- Modify: `apps/core/src/modules/inventory/movement/services/movement.service.ts`

- [ ] **Step 1: direct-ship — remove the double cast**

In `direct-ship.service.ts`, the call at line ~330 `await this.fulfillmentsService.ship(fo.id, tx as unknown as DbTx);` — since both this service and `FulfillmentsService` are `wmsSchema`-typed, the `tx` here is already `DbTx`. Apply the Migration Recipe (delete local `inTx`, use `this.dbService.run`), and change the call to `await this.fulfillmentsService.ship(fo.id, tx);` (drop `as unknown as DbTx`). If a residual type error remains, the correct fix is to type the surrounding `tx` parameter as `DbTx` (not to re-add the cast).

- [ ] **Step 2: movement — remove the double casts**

In `movement.service.ts`, apply the Migration Recipe and drop `tx as unknown as DbTx` at lines ~107 and ~234, passing the already-`DbTx`-typed `tx` directly.

- [ ] **Step 3: Verify build**

Run: `npm run build:core`
Expected: PASS with zero `as unknown as DbTx` remaining in these two files.

- [ ] **Step 4: Confirm the casts are gone**

Run: `grep -rn "as unknown as DbTx\|asTx" apps/core/src --include=*.ts | grep -v ".spec.ts"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/fulfillment/services/direct-ship.service.ts apps/core/src/modules/inventory/movement/services/movement.service.ts
git commit -m "refactor(core): drop as-unknown-as-DbTx casts in direct-ship and movement"
```

---

## Task 7: Within-BC sweep — inventory

Apply the **Migration Recipe** to every `inTx`-defining service under `apps/core/src/modules/inventory/` (excluding the already-done `product-sellable-quantity` and `movement`).

**Files (apply recipe to each):**
- `core/services/stock-event.service.ts`, `core/services/inventory-command.service.ts`, `core/services/transfer.service.ts`, `core/services/location.service.ts`, `core/services/holder.service.ts`, `core/services/safety-stock.service.ts`, `core/services/sku-location-movement.service.ts`, `core/services/return.service.ts`, `core/services/allocation-strategy.service.ts`, `core/services/sku-managers.service.ts`
- `core/repositories/stock-event.store.ts`
- `stock-projection/services/stock-projection.reader.ts`
- `warehouse/services/warehouse.manager.ts`, `warehouse/services/warehouse.reader.ts`
- `shared/services/unified-reservation.service.ts`, `shared/services/barcode.service.ts`, `shared/services/reservation-lifecycle.service.ts`
- `sku-catalog/services/sku-catalog.manager.ts`, `sku-catalog/services/sku-catalog.reader.ts`
- `sku-group/services/sku-group.manager.ts`, `sku-group/services/sku-group.reader.ts`
- `suppliers/services/supplier-categories.service.ts`, `suppliers/services/suppliers.service.ts`
- `inbound/services/inbound.service.ts`, `inbound/services/purchase-order.service.ts`
- `stocktaking/services/stocktaking.service.ts`

> Note: `inventory-command.service.ts` uses an *inline* `tx ? exec(tx) : this.db.transaction(exec)` rather than a named `inTx`. Same recipe — replace the inline expression with `this.<dbField>.run(exec, tx)`.

- [ ] **Step 1: Apply the Migration Recipe to each file above**

(For each: delete local `inTx`/inline runner, replace calls with `this.<dbField>.run(`, drop any now-unused `dbConn`/`db` getter, keep `tx?: DbTx` signatures.)

- [ ] **Step 2: Verify build**

Run: `npm run build:core`
Expected: PASS.

- [ ] **Step 3: Run inventory's existing targeted tests**

Run: `npx jest --testPathPattern='inventory/.*(stock|inventory-command|metrics)'`
Expected: PASS (behaviour unchanged).

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/modules/inventory
git commit -m "refactor(inventory): replace per-class inTx with DbService.run"
```

---

## Task 8: Within-BC sweep — product-matching

Apply the **Migration Recipe** to product-matching services (all `wmsSchema`-typed).

**Files:**
- `apps/core/src/modules/product-matching/services/product-matching.service.ts`
- `apps/core/src/modules/product-matching/services/product-sku-mapping.service.ts`

- [ ] **Step 1: Apply the Migration Recipe to both files**

(`createSnapshotForVariant(... tx?: DbTx)` and the rest keep their `DbTx` signatures — they are called from `wmsSchema`-typed sales-order, same schema, no cast.)

- [ ] **Step 2: Verify build**

Run: `npm run build:core`
Expected: PASS.

- [ ] **Step 3: Run product-matching targeted tests**

Run: `npx jest --testPathPattern=product-matching`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/modules/product-matching
git commit -m "refactor(product-matching): replace per-class inTx with DbService.run"
```

---

## Task 9: Within-BC sweep — fulfillment

Apply the **Migration Recipe** to fulfillment services (all `wmsSchema`-typed; `direct-ship` already done in Task 6).

**Files:**
- `services/availability.service.ts`, `services/fulfillment-order-transaction.service.ts`, `services/fulfillment-reservations.facade.ts`, `services/invoice.service.ts`, `services/inspection.service.ts`, `services/fulfillments.service.ts`, `services/picking-process.service.ts`, `services/outbound-batch.service.ts`
- `backlog/fulfillment-order-creation-backlog.service.ts`

- [ ] **Step 1: Apply the Migration Recipe to each file**

(`enqueueForSalesOrder` / `closeOpenForSalesOrder` keep `tx?: DbTx` — same `wmsSchema` as their sales-order caller.)

- [ ] **Step 2: Verify build**

Run: `npm run build:core`
Expected: PASS.

- [ ] **Step 3: Run fulfillment targeted tests**

Run: `npx jest --testPathPattern='fulfillment/.*(fulfillments|reservations|backlog)'`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/modules/fulfillment
git commit -m "refactor(fulfillment): replace per-class inTx with DbService.run"
```

---

## Task 10: Within-BC sweep — sales-order

Apply the **Migration Recipe** to sales-order services and consumer (all `wmsSchema`-typed).

**Files:**
- `services/sales-orders.service.ts`, `services/sales-order-amendments.service.ts`, `services/store-sales-orders.service.ts` (if it defines `inTx`)
- `consumers/order-events.consumer.ts`

- [ ] **Step 1: Apply the Migration Recipe to each file**

(Cross-BC calls inside here — `fulfillmentBacklog.enqueueForSalesOrder(..., tx)`, `library.grant/revokeOwnershipsForOrder(..., trx)`, `productSkuMapping.createSnapshotForVariant(..., trx)` — are all `wmsSchema → wmsSchema`, so the `tx`/`trx` passes through unchanged with no cast.)

- [ ] **Step 2: Verify build**

Run: `npm run build:core`
Expected: PASS.

- [ ] **Step 3: Run sales-order targeted tests**

Run: `npx jest --testPathPattern=sales-order`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/modules/sales-order
git commit -m "refactor(sales-order): replace per-class inTx with DbService.run"
```

---

## Task 11: Within-BC sweep — library (grant) and customer-service

`library.service.ts` is `wmsSchema`-typed (reads sales orders); customer-service services use a file-local `type Tx`.

**Files:**
- `library/services/library.service.ts`, `library/services/ownership.service.ts`, `library/services/digital-asset.service.ts`
- `customer-service/services/cs-cases.service.ts`, `customer-service/services/cs-comments.service.ts`, `customer-service/services/cs-labels.service.ts`

- [ ] **Step 1: Apply the Migration Recipe**

- For `library.service.ts`: keep `DbService<typeof wmsSchema>` + `DbTx` from inventory.schema; delete `inTx`; use `this.dbService.run`. `grant/revokeOwnershipsForOrder(... tx?: DbTx)` unchanged.
- For `ownership.service.ts` / `digital-asset.service.ts`: replace file-local `type Tx` with imported `TxFor<LibrarySchema>` (named e.g. `LibraryTx`); delete `inTx`; use `this.dbService.run`.
- For the three `customer-service` services: replace file-local `type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]` with `import { TxFor } from '@app/db'` and `type CsTx = TxFor<CustomerServiceSchema>` (import `CustomerServiceSchema` from the CS schema); delete `inTx`; use `this.<dbField>.run`.

- [ ] **Step 2: Verify build**

Run: `npm run build:core`
Expected: PASS.

- [ ] **Step 3: Run targeted tests**

Run: `npx jest --testPathPattern='library|customer-service'`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/modules/library apps/core/src/modules/customer-service
git commit -m "refactor(library,cs): replace per-class inTx with DbService.run"
```

---

## Task 12: Within-BC sweep — catalog

Apply the **Migration Recipe** to catalog services (all `PimSchema`-typed; tx type is `DbTransaction`).

**Files:**
- `core/products/services/product-masters.service.ts`, `product-versions.service.ts`, `product-variants.service.ts`, `product-purchase-constraints.service.ts`
- `core/products/assemblers/product-read.assembler.ts`
- `core/categories/categories.service.ts`
- `core/channels/sales-channels.service.ts`
- `core/pricing/pricing.service.ts`, `pricing-calculator.service.ts`, `pricing-validator.service.ts`, `variant-price-cache.service.ts`
- `core/tags/tags.service.ts`, `core/notices/notices.service.ts`, `core/banners/banners.service.ts`
- `operations/approval/product-approval.service.ts`

> `product-versions.service.ts` uses `private get dbConn() { return this.db.db; }` + `this.dbConn.transaction(fn)` in its `inTx`. Replace `this.inTx(` with `this.db.run(` (the injected field is `this.db: DbService<PimSchema>`), and delete the now-unused `dbConn` getter if nothing else references it.

- [ ] **Step 1: Apply the Migration Recipe to each file**

- [ ] **Step 2: Verify build**

Run: `npm run build:core`
Expected: PASS. **If `product-versions.service.ts` fails to compile** because `_reconcileMatchingsAfterPublish` queries `wmsSchema` tables through a `PimTx` (a pre-existing hidden cross-BC reach the strict typing now surfaces): do **not** widen the whole service to `MergedSchema`. Instead, narrow the fix — either (a) move that reconciliation query behind a `wmsSchema`-typed inventory/product-matching service method that accepts `tx?: AnyTx`, or (b) if out of scope for this refactor, record it as a follow-up and apply a single localized `tx as TxFor<MergedSchema>` at exactly that query with a `// cross-BC reach — see ADR-0025 follow-up` comment. Prefer (a).

- [ ] **Step 3: Run catalog targeted tests**

Run: `npx jest --testPathPattern='catalog/.*(product-versions|product-masters|product-variants|purchase-constraints|assembler|loader)'`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/modules/catalog
git commit -m "refactor(catalog): replace per-class inTx with DbService.run"
```

---

## Task 13: Final sweep verification

- [ ] **Step 1: Confirm no per-class `inTx` remains in core**

Run: `grep -rn "private async inTx<T>\|async inTx<T>" apps/core/src --include=*.ts | grep -v ".spec.ts"`
Expected: no output.

- [ ] **Step 2: Confirm no `asTx` / `as unknown as DbTx` remains in core**

Run: `grep -rn "asTx\|as unknown as DbTx\|tx?: unknown" apps/core/src --include=*.ts | grep -v ".spec.ts"`
Expected: no output.

- [ ] **Step 3: Confirm `DbService<MergedSchema>` is a short, intentional list (seam marker)**

Run: `grep -rln "DbService<MergedSchema>\|TypedDatabase<MergedSchema>" apps/core/src --include=*.ts | grep -v ".spec.ts"`
Expected: a small set (the genuine cross-BC seams, e.g. `product-sellable-quantity.service.ts`). Eyeball that nothing within-BC accidentally widened.

- [ ] **Step 4: Full core build**

Run: `npm run build:core`
Expected: PASS.

- [ ] **Step 5: Commit (if any cleanup edits were made)**

```bash
git add apps/core
git commit -m "chore(core): final transaction-runner sweep verification"
```

---

## Task 14: Record ADR-0025

**Files:**
- Create: `docs/adr/0025-single-transaction-runner.md`

- [ ] **Step 1: Write the ADR**

Create `docs/adr/0025-single-transaction-runner.md`:

```markdown
# Single transaction runner (DbService.run) supersedes per-class inTx

## Status
Accepted (2026-06-28). Supersedes the per-class transaction-helper convention recorded in CLAUDE.md's "Inventory Transaction Propagation" section, which predates the WMS–PIM merge.

## Context
`apps/core` is a single app with one `DbService` over `mergedSchema` (one postgres connection). Before this ADR, ~60 service classes each redefined an identical `private async inTx<T>(fn, tx?) { return tx ? fn(tx) : this.db.transaction(fn); }`, and the per-BC transaction type was derived three different ways (`DbTx`, `DbTransaction` as whole-db, file-local `Tx`). Because every per-BC type describes the *same* physical transaction object typed against a partial schema, transactions crossing a BC boundary could not unify, forcing `asTx(tx as unknown)` casts at the seams.

## Decision
- `@app/db` exposes three primitives: `TxFor<S>` (the one canonical tx-type derivation), `AnyTx` (the one sanctioned wide tx type for cross-BC seams), and `DbService.run<T>(fn, tx?)` (the single transaction runner).
- Per-BC tx types are derived only via `TxFor<S>` and keep their BC name (`DbTx` = `TxFor<typeof wmsSchema>`, `DbTransaction` = `TxFor<PimSchema>`, etc.).
- Within-BC services keep their narrow `DbService<S>` injection (the compile-time per-BC table-access guardrail) and call `this.<dbField>.run(fn, tx)`. The `tx?: <BcTx>` last-parameter propagation convention is retained.
- Genuine cross-schema seam services declare the wider schema (`DbService<MergedSchema>`) and accept `tx?: AnyTx`, performing one `tx as TxFor<TheirSchema>` narrowing where they run their own work. `DbService<MergedSchema>` is therefore the marker of a service permitted to cross BCs, and is expected to remain a short, reviewable list.

## Consequences
- The ~60 duplicated `inTx` helpers and the scattered `asTx`/`as unknown as DbTx` casts are removed.
- Full static type safety across BC boundaries is intentionally **not** achieved; the per-BC guardrail is kept and the residual cross-BC narrowing is concentrated to the few seam services. This trade (guardrail over zero-cast) was chosen deliberately because the guardrail (notably the 100+ `db.query.*` relational sites) is load-bearing and the cast set is small.
- The "BC writes only its own tables" rule is now enforced by the per-BC `DbService<S>` typing plus review, with cross-BC reaches surfaced as compile errors during this migration (see Task 12 note).
- Scope of this ADR's migration is `apps/core`. Other apps (analytics, ugc-service, user-service, wallet, outbox-demo) keep their own `inTx` until a follow-up adopts `@app/db`'s `run`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr/0025-single-transaction-runner.md
git commit -m "docs(adr): 0025 single transaction runner supersedes per-class inTx"
```

---

## Task 15: Rewrite the CLAUDE.md convention

**Files:**
- Modify: `CLAUDE.md` (the "Inventory Transaction Propagation (strict rule)" block under "Inventory (구 WMS) Rules")

- [ ] **Step 1: Replace the stale convention text**

In `CLAUDE.md`, replace the `**Inventory Transaction Propagation** (strict rule):` block and its code sample with:

````markdown
**Transaction Propagation** (strict rule — see ADR-0025):
```typescript
// Per-BC tx type — derived once via TxFor, named per BC. Import from the BC's
// canonical home (e.g. DbTx from inventory.schema, DbTransaction from catalog.types).
import { DbTx } from 'apps/core/src/modules/inventory/schema/inventory.schema';

// No per-class inTx helper. Use the single runner on the injected DbService.
async createFoo(dto: CreateFooDto, tx?: DbTx) {
  return this.dbService.run(async (trx) => {   // trx: DbTx inferred
    await this.otherService.doThing(trx);      // propagate trx, never this.db
  }, tx);
}

// Public methods: tx?: DbTx as last param. Private helpers: tx: DbTx required.
private async loadFoo(tx: DbTx, id: string) { ... }
```

Cross-BC seam services (those that legitimately span schemas) declare the wider
`DbService<MergedSchema>` and accept `tx?: AnyTx`, narrowing once with
`tx as TxFor<MergedSchema>`. `DbService<MergedSchema>` is the marker of a
cross-BC service and must stay a short list. Do **not** re-add per-class `inTx`
helpers or `asTx(tx as unknown)` casts.
````

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rewrite transaction propagation convention for DbService.run (ADR-0025)"
```

---

## Self-Review

**1. Spec coverage** — every decision from the design conversation maps to a task:
- `TxFor` + `AnyTx` primitives → Task 1. `DbService.run` → Task 2. Canonical per-BC derivation (fix catalog outlier) → Task 3. Cross-schema seams (`AnyTx` + single cast) → Tasks 4–6. Within-BC mechanical sweep (`run`, keep guardrail) → Tasks 7–12. Removal of `inTx`/`asTx` → verified in Task 13. `DbService<MergedSchema>` as seam marker → Task 13 Step 3. ADR → Task 14. CLAUDE.md rewrite → Task 15.

**2. Placeholder scan** — the within-BC sweep tasks (7–12) reference the **Migration Recipe** section, which contains the full transformation steps plus a complete before/after worked example; each task lists exact files and a typecheck gate. No "TODO"/"handle edge cases"/"similar to Task N" stand-ins for code remain.

**3. Type consistency** — names used consistently across tasks: `TxFor<S>`, `AnyTx`, `DbService.run`, per-BC `DbTx`/`DbTransaction`, seam `tx as TxFor<MergedSchema>`. The seam classification (only sellable-quantity is `MergedSchema`; variant-asset-link stays `LibrarySchema`; library/fulfillment/sku-mapping are `wmsSchema` within-BC) is applied identically in Tasks 4–11.

**Risk note:** Task 12 may surface a pre-existing hidden cross-BC reach in `product-versions.service.ts` (`_reconcileMatchingsAfterPublish` touching `wmsSchema` tables via `PimTx`). The task documents the narrow fix (delegate to a `wmsSchema` service) rather than widening the whole catalog service — this is the guardrail doing its job and must not be "fixed" by blanket-widening to `MergedSchema`.
