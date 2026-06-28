# Catalog Orphan-Cleanup Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the version-owned "orphan entity cleanup" primitive — duplicated 7× across 4 catalog services — with one tested pure function, and add the missing characterization tests for the variant copy-on-write (CoW) edit + pricing cascade.

**Architecture:** Decision recorded in `docs/adr/0026-version-cow-targeted-decomposition.md`. We do NOT build the proposed parameterized "version CoW module" — only the genuinely-identical primitive (`deleteEntitiesIfUnmapped`) is extracted. The CoW decision branch (variant, purchase constraint) and cross-BC cascade stay per-concern. One richer variant cleanup (`product-masters.service.ts:1898`, a status-join rule) is intentionally left untouched.

**Tech Stack:** NestJS, Drizzle ORM (`postgres-js`), Jest with hand-rolled fake-tx unit tests (the repo's established pattern — no real DB in unit tests).

---

## Why this query shape (read before Task 1)

The helper is consumed by services whose existing specs use stateful fake-tx objects. Those fakes have **incompatible** assumptions:
- `product-purchase-constraints.service.spec.ts` `makeStatefulTx`: `projectRows` throws on a bare `select()` (does `'value' in selection` on `undefined`), but supports `count()`.
- `product-versions.service.spec.ts` `makeDeleteDraftTx` and `product-masters.service.spec.ts` `makeHardDeleteTx`: support bare `select()`, but NOT `count()`.

A helper using `count()` would break the versions/masters fakes; a helper using bare `select()` would break the purchase-constraints fake. **Resolution:** the helper selects a *named column* — `select({ ref: junctionFkColumn })` — and checks `.length === 0`. With a named selection that has no `value` key, every fake returns an array of length = matching rows, so all three stay green with **zero fake patches**. This also matches 6 of the 7 plain call sites' existing shape (only `deleteIfOrphan` used `count()`; switching it to named-select+length is behavior-equivalent).

## Sites in scope (7 plain copies → helper)

| Entity | File:method | Current shape |
|---|---|---|
| pricing rule | `catalog/core/pricing/pricing.service.ts:226` `_cleanupOrphanedPricingRules` | select-all + `.length` |
| pricing rule | `catalog/core/products/services/product-versions.service.ts:1412` `_cleanupOrphanedPricingRules` | select-all + `.length` |
| purchase constraint | `product-versions.service.ts:1436` `_cleanupOrphanedPurchaseConstraints` | select-all + `.length` |
| variant | `product-versions.service.ts:1381` `_cleanupOrphanedVariantsAfterDeletion` | `select({versionId})` + `and(masterId, variantId)` + `.length` |
| purchase constraint | `product-masters.service.ts:1393` `_cleanupOrphanedPurchaseConstraints` | select-all + `.length` |
| variant | `product-masters.service.ts:1046-1058` (inline loop) | `select({count})` + `eq(variantId)` |
| purchase constraint | `product-purchase-constraints.service.ts:273` `deleteIfOrphan` | `select({count})` + `eq` |

**Excluded (do NOT touch):** `product-masters.service.ts:1898` `_cleanupOrphanedVariants` — deletes when `length === 0` **or** the only remaining mapping is the current draft (status join). Not the same primitive.

**Behavior note:** the variant sites drop a redundant `masterId` predicate (a `variantId` is globally unique and belongs to one master, so counting by `variantId` alone is identical). This is the drift the helper removes.

---

## File Structure

- **Create** `apps/core/src/modules/catalog/core/version-isolation/delete-if-unmapped.ts` — the pure helper. One responsibility: delete entities with zero remaining version-junction references. No NestJS, no DI, no schema imports (generic over Drizzle table/column).
- **Create** `apps/core/src/modules/catalog/core/version-isolation/delete-if-unmapped.spec.ts` — helper unit tests.
- **Modify** `apps/core/src/modules/catalog/core/pricing/pricing.service.ts` — delegate `_cleanupOrphanedPricingRules` to the helper.
- **Modify** `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts` — delegate 3 cleanup methods.
- **Modify** `apps/core/src/modules/catalog/core/products/services/product-masters.service.ts` — delegate 1 method + 1 inline loop.
- **Modify** `apps/core/src/modules/catalog/core/products/services/product-purchase-constraints.service.ts` — delegate `deleteIfOrphan`.
- **Modify** `apps/core/src/modules/catalog/core/products/services/product-variants.service.spec.ts` — add CoW + cascade characterization tests.
- **Modify** `docs/adr/0026-version-cow-targeted-decomposition.md` — correct the "8벌" count to "7 + 1 excluded".

**Ordering rationale:** Task 1 (helper + its unit test) is the safety net for the swaps. Tasks 2–6 swap call sites; each runs the affected service's existing spec as a regression check. Tasks 7–8 add the characterization tests the ADR promised (they protect future B/C work and close the cascade's pre-existing zero-test gap; the swaps don't modify those code paths, so their order relative to the swaps is immaterial).

**Test runner note:** Never run the full Jest suite (OOM). Always scope with `--testPathPattern`.

---

### Task 1: Create the `deleteEntitiesIfUnmapped` helper (TDD)

**Files:**
- Create: `apps/core/src/modules/catalog/core/version-isolation/delete-if-unmapped.ts`
- Test: `apps/core/src/modules/catalog/core/version-isolation/delete-if-unmapped.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/core/src/modules/catalog/core/version-isolation/delete-if-unmapped.spec.ts`:

```typescript
import {
  productMasterPurchaseConstraints,
  productPurchaseConstraints,
} from '../../schema/catalog.schema';
import { deleteEntitiesIfUnmapped } from './delete-if-unmapped';

describe('deleteEntitiesIfUnmapped', () => {
  const spec = {
    entityTable: productPurchaseConstraints,
    entityIdColumn: productPurchaseConstraints.id,
    junctionTable: productMasterPurchaseConstraints,
    junctionFkColumn: productMasterPurchaseConstraints.purchaseConstraintId,
  };

  // Extract the bound id from an `eq(column, id)` Drizzle condition.
  function idFromCondition(condition: any): string | undefined {
    const findParam = (chunk: any): any => {
      if (
        chunk &&
        Object.prototype.hasOwnProperty.call(chunk, 'value') &&
        Object.prototype.hasOwnProperty.call(chunk, 'encoder')
      ) {
        return chunk;
      }
      const chunks = chunk?.queryChunks;
      if (Array.isArray(chunks)) {
        for (const c of chunks) {
          const found = findParam(c);
          if (found) return found;
        }
      }
      return undefined;
    };
    return findParam(condition)?.value;
  }

  function makeTx(mappingCounts: Record<string, number>) {
    const deletedIds: string[] = [];
    const tx: any = {
      select: () => ({
        from: () => ({
          where: (condition: any) => {
            const id = idFromCondition(condition) ?? '';
            const n = mappingCounts[id] ?? 0;
            return Array.from({ length: n }, () => ({ ref: id }));
          },
        }),
      }),
      delete: () => ({
        where: (condition: any) => {
          deletedIds.push(idFromCondition(condition) ?? '');
          return Promise.resolve();
        },
      }),
    };
    return { tx, deletedIds };
  }

  it('deletes an entity with zero remaining junction mappings', async () => {
    const { tx, deletedIds } = makeTx({ orphan: 0 });
    const count = await deleteEntitiesIfUnmapped(tx, spec, ['orphan']);
    expect(count).toBe(1);
    expect(deletedIds).toEqual(['orphan']);
  });

  it('keeps an entity still referenced by another version', async () => {
    const { tx, deletedIds } = makeTx({ shared: 2 });
    const count = await deleteEntitiesIfUnmapped(tx, spec, ['shared']);
    expect(count).toBe(0);
    expect(deletedIds).toEqual([]);
  });

  it('deletes only the orphans in a mixed batch', async () => {
    const { tx, deletedIds } = makeTx({ a: 0, b: 1 });
    const count = await deleteEntitiesIfUnmapped(tx, spec, ['a', 'b']);
    expect(count).toBe(1);
    expect(deletedIds).toEqual(['a']);
  });

  it('dedupes candidate ids so an orphan is checked and deleted once', async () => {
    const { tx, deletedIds } = makeTx({ x: 0 });
    const count = await deleteEntitiesIfUnmapped(tx, spec, ['x', 'x']);
    expect(count).toBe(1);
    expect(deletedIds).toEqual(['x']);
  });

  it('does nothing for an empty candidate list', async () => {
    const { tx, deletedIds } = makeTx({});
    const count = await deleteEntitiesIfUnmapped(tx, spec, []);
    expect(count).toBe(0);
    expect(deletedIds).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPattern=delete-if-unmapped.spec`
Expected: FAIL — `Cannot find module './delete-if-unmapped'`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/core/src/modules/catalog/core/version-isolation/delete-if-unmapped.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { DbTransaction } from '../../catalog.types';

export interface OrphanCleanupSpec {
  /** The owned entity table whose rows get deleted when unreferenced. */
  entityTable: PgTable;
  /** Primary-key column of `entityTable` (matched against each candidate id). */
  entityIdColumn: PgColumn;
  /** The version-junction table that references the entity. */
  junctionTable: PgTable;
  /** The column in `junctionTable` that points at `entityTable`'s id. */
  junctionFkColumn: PgColumn;
}

/**
 * 버전 격리에서 entity row 와 version mapping 을 분리한 뒤, 어떤 entity 를 가리키는
 * junction row 가 0개로 남으면 그 entity 를 삭제한다 (orphan 정리).
 *
 * variant·pricing rule·purchase constraint 가 각자 손구현하던 동일 프리미티브를 통일한 것.
 * 자세한 결정은 docs/adr/0026-version-cow-targeted-decomposition.md.
 *
 * @returns 삭제된 entity 수
 */
export async function deleteEntitiesIfUnmapped(
  tx: DbTransaction,
  spec: OrphanCleanupSpec,
  candidateIds: string[],
): Promise<number> {
  let deletedCount = 0;
  for (const id of new Set(candidateIds)) {
    const remaining = await tx
      .select({ ref: spec.junctionFkColumn })
      .from(spec.junctionTable)
      .where(eq(spec.junctionFkColumn, id));
    if (remaining.length === 0) {
      await tx.delete(spec.entityTable).where(eq(spec.entityIdColumn, id));
      deletedCount += 1;
    }
  }
  return deletedCount;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --testPathPattern=delete-if-unmapped.spec`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/catalog/core/version-isolation/delete-if-unmapped.ts \
        apps/core/src/modules/catalog/core/version-isolation/delete-if-unmapped.spec.ts
git commit -m "feat(catalog): add deleteEntitiesIfUnmapped version-isolation helper"
```

---

### Task 2: Delegate pricing rule cleanup in `pricing.service.ts`

**Files:**
- Modify: `apps/core/src/modules/catalog/core/pricing/pricing.service.ts:226-250`

This service has no spec; it is guarded by the build/type-check (Step 3) and by the helper's own unit test.

- [ ] **Step 1: Add the helper import**

In `pricing.service.ts`, after the existing `import { v7 as uuidv7 } from 'uuid';` line, add:

```typescript
import { deleteEntitiesIfUnmapped } from '../version-isolation/delete-if-unmapped';
```

- [ ] **Step 2: Replace the method body**

Replace the entire `_cleanupOrphanedPricingRules` method (the `private async _cleanupOrphanedPricingRules(candidateRuleIds: string[], tx: DbTransaction): Promise<void> { ... }` block) with:

```typescript
  private async _cleanupOrphanedPricingRules(candidateRuleIds: string[], tx: DbTransaction): Promise<void> {
    const deletedCount = await deleteEntitiesIfUnmapped(
      tx,
      {
        entityTable: pricingRules,
        entityIdColumn: pricingRules.id,
        junctionTable: productMasterPricingRules,
        junctionFkColumn: productMasterPricingRules.pricingRuleId,
      },
      candidateRuleIds,
    );

    if (deletedCount > 0) {
      this.logger.log(`Cleaned up ${deletedCount} orphaned pricing rules out of ${candidateRuleIds.length} candidates`);
    }
  }
```

- [ ] **Step 3: Type-check the build**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: no errors. (If `asc`/`SQL` etc. were only used by the removed code, the linter in Task 8 fixes unused imports — but they are used elsewhere in this file, so none should become unused here.)

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/modules/catalog/core/pricing/pricing.service.ts
git commit -m "refactor(catalog): pricing orphan cleanup uses deleteEntitiesIfUnmapped"
```

---

### Task 3: Delegate `deleteIfOrphan` in `product-purchase-constraints.service.ts`

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/services/product-purchase-constraints.service.ts:273-282`
- Regression: `product-purchase-constraints.service.spec.ts`

- [ ] **Step 1: Add the helper import**

After `import { UpsertPurchaseConstraintDto } from '../dto/purchase-constraints';` add:

```typescript
import { deleteEntitiesIfUnmapped } from '../../../version-isolation/delete-if-unmapped';
```

- [ ] **Step 2: Replace the method body**

Replace the entire `private async deleteIfOrphan(purchaseConstraintId: string, tx: DbTransaction): Promise<void> { ... }` block with:

```typescript
  private async deleteIfOrphan(purchaseConstraintId: string, tx: DbTransaction): Promise<void> {
    await deleteEntitiesIfUnmapped(
      tx,
      {
        entityTable: productPurchaseConstraints,
        entityIdColumn: productPurchaseConstraints.id,
        junctionTable: productMasterPurchaseConstraints,
        junctionFkColumn: productMasterPurchaseConstraints.purchaseConstraintId,
      },
      [purchaseConstraintId],
    );
  }
```

- [ ] **Step 3: Run the existing spec to verify no regression**

Run: `npx jest --testPathPattern=product-purchase-constraints.service.spec`
Expected: PASS — including "uses delete intent to remove the mapping and delete an orphaned constraint row" and "deleteForDraft removes only the mapping and keeps a shared constraint row". (The named-column select keeps `makeStatefulTx` green; `count` is still used by `isConstraintShared`, so its import stays.)

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/services/product-purchase-constraints.service.ts
git commit -m "refactor(catalog): purchase-constraint orphan cleanup uses deleteEntitiesIfUnmapped"
```

---

### Task 4: Delegate the 3 cleanup methods in `product-versions.service.ts`

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts` (`_cleanupOrphanedVariantsAfterDeletion:1381`, `_cleanupOrphanedPricingRules:1412`, `_cleanupOrphanedPurchaseConstraints:1436`)
- Regression: `product-versions.service.spec.ts`

- [ ] **Step 1: Add the helper import**

After `import { v7 as uuidv7 } from 'uuid';` add:

```typescript
import { deleteEntitiesIfUnmapped } from '../../../version-isolation/delete-if-unmapped';
```

- [ ] **Step 2: Replace `_cleanupOrphanedVariantsAfterDeletion`**

Replace the entire `private async _cleanupOrphanedVariantsAfterDeletion(masterId: string, candidateVariantIds: string[], tx: DbTransaction): Promise<void> { ... }` block with:

```typescript
  private async _cleanupOrphanedVariantsAfterDeletion(
    masterId: string,
    candidateVariantIds: string[],
    tx: DbTransaction,
  ): Promise<void> {
    const deletedCount = await deleteEntitiesIfUnmapped(
      tx,
      {
        entityTable: productVariants,
        entityIdColumn: productVariants.id,
        junctionTable: productMasterVariants,
        junctionFkColumn: productMasterVariants.variantId,
      },
      candidateVariantIds,
    );

    if (deletedCount > 0) {
      this.logger.log(`Cleaned up ${deletedCount} orphaned variant entities`);
    }
  }
```

Note: `masterId` is now unused inside the method but kept in the signature so the call site at `:1355` stays unchanged. Drop it only if the linter flags it; otherwise leave it (the redundant filter removal is intentional — see "Behavior note" above).

- [ ] **Step 3: Replace `_cleanupOrphanedPricingRules`**

Replace the entire `private async _cleanupOrphanedPricingRules(candidateRuleIds: string[], tx: DbTransaction): Promise<void> { ... }` block (the one near `:1412`) with:

```typescript
  private async _cleanupOrphanedPricingRules(candidateRuleIds: string[], tx: DbTransaction): Promise<void> {
    const deletedCount = await deleteEntitiesIfUnmapped(
      tx,
      {
        entityTable: pricingRules,
        entityIdColumn: pricingRules.id,
        junctionTable: productMasterPricingRules,
        junctionFkColumn: productMasterPricingRules.pricingRuleId,
      },
      candidateRuleIds,
    );

    if (deletedCount > 0) {
      this.logger.log(`Cleaned up ${deletedCount} orphaned pricing rules`);
    }
  }
```

- [ ] **Step 4: Replace `_cleanupOrphanedPurchaseConstraints`**

Replace the entire `private async _cleanupOrphanedPurchaseConstraints(candidateConstraintIds: string[], tx: DbTransaction): Promise<void> { ... }` block with:

```typescript
  private async _cleanupOrphanedPurchaseConstraints(
    candidateConstraintIds: string[],
    tx: DbTransaction,
  ): Promise<void> {
    const deletedCount = await deleteEntitiesIfUnmapped(
      tx,
      {
        entityTable: productPurchaseConstraints,
        entityIdColumn: productPurchaseConstraints.id,
        junctionTable: productMasterPurchaseConstraints,
        junctionFkColumn: productMasterPurchaseConstraints.purchaseConstraintId,
      },
      candidateConstraintIds,
    );

    if (deletedCount > 0) {
      this.logger.log(`Cleaned up ${deletedCount} orphaned purchase constraints`);
    }
  }
```

- [ ] **Step 5: Run the existing spec to verify no regression**

Run: `npx jest --testPathPattern=product-versions.service.spec`
Expected: PASS — including the "deleteDraftVersion purchase constraint cleanup" block (both "deletes a draft-only..." and "keeps a shared..."). The named-column select keeps `makeDeleteDraftTx` green.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/services/product-versions.service.ts
git commit -m "refactor(catalog): version-delete orphan cleanups use deleteEntitiesIfUnmapped"
```

---

### Task 5: Delegate cleanup in `product-masters.service.ts` (1 method + 1 inline loop)

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/services/product-masters.service.ts` (`_cleanupOrphanedPurchaseConstraints:1393`, inline loop `:1046-1058`)
- Regression: `product-masters.service.spec.ts`
- **Do NOT touch** `_cleanupOrphanedVariants:1898` (excluded — richer status-join rule).

- [ ] **Step 1: Add the helper import**

After the existing `uuid` import in `product-masters.service.ts`, add:

```typescript
import { deleteEntitiesIfUnmapped } from '../../../version-isolation/delete-if-unmapped';
```

- [ ] **Step 2: Replace `_cleanupOrphanedPurchaseConstraints`**

Replace the entire `private async _cleanupOrphanedPurchaseConstraints(candidateConstraintIds: string[], tx: DbTransaction): Promise<void> { ... }` block with:

```typescript
  private async _cleanupOrphanedPurchaseConstraints(
    candidateConstraintIds: string[],
    tx: DbTransaction,
  ): Promise<void> {
    await deleteEntitiesIfUnmapped(
      tx,
      {
        entityTable: productPurchaseConstraints,
        entityIdColumn: productPurchaseConstraints.id,
        junctionTable: productMasterPurchaseConstraints,
        junctionFkColumn: productMasterPurchaseConstraints.purchaseConstraintId,
      },
      candidateConstraintIds,
    );
  }
```

- [ ] **Step 3: Replace the inline variant-cleanup loop**

Find this block (around `:1046-1058`):

```typescript
      // 실제 variant 레코드 삭제 (다른 버전에서 사용되지 않는 경우)
      if (existingMappings.length > 0) {
        for (const { variantId } of existingMappings) {
          const otherMappings = await tx
            .select({ count: count() })
            .from(productMasterVariants)
            .where(eq(productMasterVariants.variantId, variantId));

          if (otherMappings[0].count === 0) {
            await tx.delete(productVariants).where(eq(productVariants.id, variantId));
          }
        }
      }
```

Replace it with:

```typescript
      // 실제 variant 레코드 삭제 (다른 버전에서 사용되지 않는 경우)
      await deleteEntitiesIfUnmapped(
        tx,
        {
          entityTable: productVariants,
          entityIdColumn: productVariants.id,
          junctionTable: productMasterVariants,
          junctionFkColumn: productMasterVariants.variantId,
        },
        existingMappings.map((m) => m.variantId),
      );
```

(`count` remains imported — it is still used by `existsMaster`.)

- [ ] **Step 4: Run the existing spec to verify no regression**

Run: `npx jest --testPathPattern=product-masters.service.spec`
Expected: PASS — including "hardDelete purchase constraint cleanup" → "deletes an unshared purchase constraint row after permanently deleting its version". The named-column select keeps `makeHardDeleteTx` green.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/services/product-masters.service.ts
git commit -m "refactor(catalog): master orphan cleanups use deleteEntitiesIfUnmapped"
```

---

### Task 6: Verify the whole catalog test surface + lint after swaps

**Files:** none (verification only).

- [ ] **Step 1: Run all touched catalog specs together**

Run: `npx jest --testPathPattern="catalog/core/(pricing|products)"`
Expected: PASS. No assertion changes were needed in any existing spec (named-column select preserved every fake's behavior).

- [ ] **Step 2: Lint the changed files (auto-fix unused imports)**

Run: `npx eslint --fix apps/core/src/modules/catalog/core/pricing/pricing.service.ts apps/core/src/modules/catalog/core/products/services/product-versions.service.ts apps/core/src/modules/catalog/core/products/services/product-masters.service.ts apps/core/src/modules/catalog/core/products/services/product-purchase-constraints.service.ts apps/core/src/modules/catalog/core/version-isolation/delete-if-unmapped.ts`
Expected: clean (or auto-fixed). Review any change before committing.

- [ ] **Step 3: Commit (only if lint changed files)**

```bash
git add -A
git commit -m "chore(catalog): lint cleanup after orphan-cleanup dedup"
```

---

### Task 7: Characterization test — variant→pricing cascade (currently zero tests)

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/services/product-variants.service.spec.ts`

Locks `_cascadeVariantCoWToPricingRules` (`product-variants.service.ts:503-578`) before any future B/C refactor. Tested directly via `(service as any)` (the repo already calls privates this way in `product-purchase-constraints.service.spec.ts`).

- [ ] **Step 1: Write the failing tests**

At the top of `product-variants.service.spec.ts`, add to the existing schema import (it currently imports only types) a value import:

```typescript
import { pricingRules, productMasterPricingRules } from '../../../schema/catalog.schema';
```

Then append this new describe block at the end of the file:

```typescript
describe('ProductVariantsService variant→pricing cascade CoW (docs/adr/0004)', () => {
  function makeService() {
    return new ProductVariantsService(
      { run: (fn: any, t?: any) => (t ? fn(t) : fn(undefined)) } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  }

  function makeCascadeTx(draftRules: any[], otherMapping: Array<{ versionId: string }>) {
    const inserted: any[] = [];
    const repointed: any[] = [];
    const inPlace: any[] = [];
    let selectCall = 0;

    const tx: any = {
      select: jest.fn(() => {
        const current = selectCall++;
        if (current === 0) {
          // draftRules query: .from().innerJoin().where()
          return { from: () => ({ innerJoin: () => ({ where: () => draftRules }) }) };
        }
        // otherMapping query: .from().where().limit()
        return { from: () => ({ where: () => ({ limit: () => otherMapping }) }) };
      }),
      insert: jest.fn((table: unknown) => ({
        values: (vals: any) => {
          if (table === pricingRules) inserted.push(vals);
          return Promise.resolve();
        },
      })),
      update: jest.fn((table: unknown) => ({
        set: (vals: any) => ({
          where: () => {
            if (table === pricingRules) inPlace.push(vals);
            else if (table === productMasterPricingRules) repointed.push(vals);
            return Promise.resolve();
          },
        }),
      })),
    };

    return { tx, inserted, repointed, inPlace };
  }

  const sharedRule = {
    ruleId: 'rule-1',
    layer: 'base_price',
    order: 0,
    scopeType: 'variants',
    scopeTargetIds: ['old-variant', 'keep-variant'],
    operationType: 'fixed',
    operationValue: '1000',
    minQuantity: null,
  };

  it('clones and repoints a pricing rule shared with another version', async () => {
    const service = makeService() as any;
    const { tx, inserted, repointed, inPlace } = makeCascadeTx([sharedRule], [{ versionId: 'other-version' }]);

    await service._cascadeVariantCoWToPricingRules('master-1', 'version-draft', 'old-variant', 'new-variant', tx);

    expect(inserted).toEqual([
      expect.objectContaining({
        layer: 'base_price',
        order: 0,
        scopeType: 'variants',
        scopeTargetIds: ['new-variant', 'keep-variant'],
        operationType: 'fixed',
        operationValue: '1000',
        minQuantity: null,
      }),
    ]);
    expect(repointed).toHaveLength(1);
    expect(inPlace).toHaveLength(0);
  });

  it('updates a pricing rule in place when it is not shared', async () => {
    const service = makeService() as any;
    const { tx, inserted, repointed, inPlace } = makeCascadeTx([sharedRule], []);

    await service._cascadeVariantCoWToPricingRules('master-1', 'version-draft', 'old-variant', 'new-variant', tx);

    expect(inserted).toHaveLength(0);
    expect(repointed).toHaveLength(0);
    expect(inPlace).toEqual([
      expect.objectContaining({ scopeTargetIds: ['new-variant', 'keep-variant'] }),
    ]);
  });

  it('leaves a pricing rule untouched when it does not reference the cowed variant', async () => {
    const service = makeService() as any;
    const unrelatedRule = { ...sharedRule, ruleId: 'rule-2', scopeTargetIds: ['some-other-variant'] };
    const { tx, inserted, repointed, inPlace } = makeCascadeTx([unrelatedRule], [{ versionId: 'other-version' }]);

    await service._cascadeVariantCoWToPricingRules('master-1', 'version-draft', 'old-variant', 'new-variant', tx);

    expect(inserted).toHaveLength(0);
    expect(repointed).toHaveLength(0);
    expect(inPlace).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify the tests pass against current behavior**

Run: `npx jest --testPathPattern=product-variants.service.spec`
Expected: PASS (existing test + 3 new). These are characterization tests over unchanged code, so they pass immediately — that is the point (they lock current behavior).

- [ ] **Step 3: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/services/product-variants.service.spec.ts
git commit -m "test(catalog): characterize variant→pricing cascade CoW"
```

---

### Task 8: Characterization test — variant CoW edit decision + correct the ADR

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/services/product-variants.service.spec.ts`
- Modify: `docs/adr/0026-version-cow-targeted-decomposition.md`

Locks the shared→clone / single→in-place decision in `updateVariantInDraft` (`product-variants.service.ts:390-418`). The shared case uses zero pricing rules so the cascade select returns `[]` (cascade itself is covered by Task 7).

- [ ] **Step 1: Write the failing tests**

Append this describe block to `product-variants.service.spec.ts`:

```typescript
describe('ProductVariantsService updateVariantInDraft CoW decision', () => {
  const limitSelect = (rows: unknown[]) => ({ from: () => ({ where: () => ({ limit: () => rows }) }) });
  const arraySelect = (rows: unknown[]) => ({ from: () => ({ where: () => rows }) });
  const joinSelect = (rows: unknown[]) => ({ from: () => ({ innerJoin: () => ({ where: () => rows }) }) });

  function makeService() {
    const productVersionsService = {
      getVersionById: jest.fn().mockResolvedValue({ id: 'version-draft', masterId: 'master-1', status: 'draft' }),
    };
    const variantAssetLinkService = {
      cloneLinksForVariant: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ProductVariantsService(
      { run: (fn: any, t?: any) => (t ? fn(t) : fn(undefined)) } as any,
      productVersionsService as any,
      {} as any,
      variantAssetLinkService as any,
    );
    return { service, variantAssetLinkService };
  }

  it('updates in place (no CoW) when the variant maps to this version only', async () => {
    const { service, variantAssetLinkService } = makeService();
    const tx: any = {
      select: jest
        .fn()
        .mockReturnValueOnce(limitSelect([{ masterId: 'master-1', versionId: 'version-draft', variantId: 'variant-1' }]))
        .mockReturnValueOnce(limitSelect([])), // no shared mapping
      update: jest.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
    };

    const result = await service.updateVariantInDraft(
      'master-1',
      'version-draft',
      'variant-1',
      { variantName: 'Y' },
      tx,
    );

    expect(result).toEqual({ variantId: 'variant-1', cowed: false });
    expect(variantAssetLinkService.cloneLinksForVariant).not.toHaveBeenCalled();
  });

  it('clones the variant and cascades when the variant is shared with another version', async () => {
    const { service, variantAssetLinkService } = makeService();
    const tx: any = {
      select: jest
        .fn()
        .mockReturnValueOnce(limitSelect([{ masterId: 'master-1', versionId: 'version-draft', variantId: 'old-variant' }]))
        .mockReturnValueOnce(limitSelect([{ versionId: 'other-version' }])) // shared!
        .mockReturnValueOnce(
          limitSelect([
            {
              id: 'old-variant',
              variantName: 'X',
              imageId: null,
              displayOrder: 0,
              status: 'active',
              isDefault: false,
              variantCode: 'C',
            },
          ]),
        ) // _cloneVariant source
        .mockReturnValueOnce(arraySelect([])) // _cloneVariantOptionValues: none
        .mockReturnValueOnce(joinSelect([])), // cascade: no pricing rules
      insert: jest.fn(() => ({ values: () => Promise.resolve() })),
      update: jest.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
    };

    const result = await service.updateVariantInDraft(
      'master-1',
      'version-draft',
      'old-variant',
      { variantName: 'Y' },
      tx,
    );

    expect(result.cowed).toBe(true);
    expect(result.variantId).not.toBe('old-variant');
    expect(variantAssetLinkService.cloneLinksForVariant).toHaveBeenCalledWith('old-variant', result.variantId, tx);
  });
});
```

- [ ] **Step 2: Run to verify the tests pass against current behavior**

Run: `npx jest --testPathPattern=product-variants.service.spec`
Expected: PASS (all prior + 2 new).

- [ ] **Step 3: Correct the orphan-copy count in ADR-0026**

In `docs/adr/0026-version-cow-targeted-decomposition.md`, find the sentence beginning "단 하나, 진짜로 동일한 프리미티브 — 고아 정리 — 만 추출한다." and the bullet that says it exists in "**4개 파일에 8벌**". Replace that count clause:

Find:
```
"이 entity 를 가리키는 정션이 0개면 entity 삭제"가 **4개 파일에 8벌** 존재한다(variant 3, pricing rule 2, purchase constraint 3; 그중 `product-masters.service.ts:1046-1058` 은 메서드 추출조차 안 된 인라인). 이를 순수 함수 하나로 통일한다:
```

Replace with:
```
"이 entity 를 가리키는 정션이 0개면 entity 삭제"가 **4개 파일에 7벌** 존재한다(variant 2, pricing rule 2, purchase constraint 3; 그중 `product-masters.service.ts:1046-1058` 은 메서드 추출조차 안 된 인라인). `product-masters.service.ts:1898` `_cleanupOrphanedVariants` 는 "남은 매핑이 현재 draft 뿐이면 삭제" 라는 status-join 분기가 더 있어 같은 프리미티브가 아니므로 **제외**한다(통합하면 동작 변경 또는 predicate-hook 과추상화). 7벌을 순수 함수 하나로 통일한다:
```

- [ ] **Step 4: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/services/product-variants.service.spec.ts \
        docs/adr/0026-version-cow-targeted-decomposition.md
git commit -m "test(catalog): characterize variant CoW edit decision; correct ADR-0026 count"
```

---

### Task 9: Final build verification

**Files:** none.

- [ ] **Step 1: Type-check the core app**

Run: `npx tsc -p apps/core/tsconfig.app.json --noEmit`
Expected: no errors.

- [ ] **Step 2: Build core**

Run: `nest build core`
Expected: success.

- [ ] **Step 3: Re-run the full catalog test slice one last time**

Run: `npx jest --testPathPattern="catalog/core/(pricing|products)/" && npx jest --testPathPattern=delete-if-unmapped.spec`
Expected: PASS.

---

## Self-Review

- **Spec coverage (ADR-0026):** "extract orphan cleanup into one pure function" → Task 1; "replace the 7 plain copies" → Tasks 2–5; "add characterization tests for variant CoW (:390-418) and the untested cascade (:503-578)" → Tasks 8 and 7. "Exclude the richer variant rule" → Task 5 note + Task 8 ADR correction.
- **Placeholder scan:** every code step shows full code; every run step shows the exact command and expected result. No TBD/"handle edge cases".
- **Type/name consistency:** `deleteEntitiesIfUnmapped(tx, spec, ids)` and `OrphanCleanupSpec { entityTable, entityIdColumn, junctionTable, junctionFkColumn }` are used identically in Task 1 and every call site (Tasks 2–5). The private method names match the current code being replaced (`_cleanupOrphanedPricingRules`, `_cleanupOrphanedPurchaseConstraints`, `_cleanupOrphanedVariantsAfterDeletion`, `deleteIfOrphan`). `_cleanupOrphanedVariants` (masters:1898) is never referenced as a swap target.
- **Risk note logged:** the variant sites intentionally drop the redundant `masterId` filter; this is behavior-equivalent (globally-unique `variantId`) and is stated in "Behavior note" and locked by reasoning, not by a DB test (the repo has no integration-DB unit harness).
