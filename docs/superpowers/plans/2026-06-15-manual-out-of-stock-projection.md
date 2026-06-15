# Manual Out Of Stock Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to keep a sellable product visible while forcing its Medusa sellable inventory projection to stock-managed quantity `0`, even when the variant has no SKU matching.

**Architecture:** Add a variant-level availability override to Core's `sales_variant_policies`, feed that policy into `ProductSellableQuantityService`, and make `calculateProductSellableQuantity` return `MANUAL_OUT_OF_STOCK` before matching/SKU checks. Expose the override through the existing matching stock-policy API/UI so admin users can toggle it from the variant matching editor. Medusa remains a projection target, not the source of truth.

**Tech Stack:** NestJS, Drizzle ORM, Jest, Next.js admin-web, React Query, Medusa inventory projection utilities.

---

## File Structure

- Modify `apps/core/src/modules/inventory/schema/inventory.schema.ts`
  Add nullable `availabilityOverride` to `salesVariantPolicies`.
- Create `apps/core/drizzle/20260615120000_add-availability-override-to-sales-variant-policies.sql`
  Add the database column.
- Modify `packages/event-contracts/streams/inventory.stream.ts`
  Add `MANUAL_OUT_OF_STOCK` to product sellable quantity event reason types and schema.
- Modify `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.calculator.ts`
  Add `availabilityOverride` to the calculator input and short-circuit to zero after visibility/time gates, before matching gates.
- Modify `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.calculator.spec.ts`
  Add tests for manual out of stock with no matching and with `void` strategy.
- Modify `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.ts`
  Load `sales_variant_policies` and pass the override into calculator input.
- Modify `apps/core/src/modules/inventory/product-sellable-quantity/dto/product-sellable-quantity.dto.ts`
  Add `MANUAL_OUT_OF_STOCK` to API enum documentation and include `availabilityOverride` in DTO.
- Modify `packages/domain-types/medusa-inventory-projection.ts`
  Ensure `MANUAL_OUT_OF_STOCK` is not treated as non-stock-gated.
- Create `packages/domain-types/medusa-inventory-projection.spec.ts`
  Add regression tests for projection gating.
- Modify `apps/core/src/modules/product-matching/dto/resolve-matching.dto.ts`
  Accept `availabilityOverride` in `StockPolicyDto`.
- Modify `apps/core/src/modules/product-matching/dto/upsert-matching.dto.ts`
  Accept `availabilityOverride` in `MatchingPolicyDto`.
- Modify `apps/core/src/modules/inventory/core/dto/product-matching/resolve-matching.dto.ts`
  Keep duplicate legacy DTO in sync.
- Modify `apps/core/src/modules/product-matching/services/product-matching.service.ts`
  Persist override to `sales_variant_policies`, return it in stock-policy reads, and recalculate projection after changes.
- Modify `apps/core/src/modules/product-matching/services/product-matching.service.spec.ts`
  Add service tests for stock policy override persistence and recalculation.
- Modify `apps/admin-web/src/lib/types/dto/matching.ts`
  Add `AvailabilityOverride` type and include it in `StockPolicyDto`.
- Modify `apps/admin-web/src/lib/services/matching/transformers.ts`
  Default `availabilityOverride` to `null`.
- Modify `apps/admin-web/src/features/matching/products/components/variant-editor-dialog/stock-policy-section.tsx`
  Add "수동 품절" checkbox to stock policy editor.
- Modify `apps/admin-web/src/features/matching/products/components/variant-editor-dialog/index.tsx`
  Existing comparison/save path should continue to save the expanded policy.
- Modify `apps/admin-web/src/features/matching/variants/components/editor-dialog/index.tsx`
  Existing comparison/save path should continue to save the expanded policy.

## Task 1: Schema, Event Contract, And Medusa Gating Type Surface

**Files:**
- Modify: `apps/core/src/modules/inventory/schema/inventory.schema.ts`
- Create: `apps/core/drizzle/20260615120000_add-availability-override-to-sales-variant-policies.sql`
- Modify: `packages/event-contracts/streams/inventory.stream.ts`
- Modify: `packages/domain-types/medusa-inventory-projection.ts`
- Create: `packages/domain-types/medusa-inventory-projection.spec.ts`

- [ ] **Step 1: Write the failing domain-types regression test**

Create `packages/domain-types/medusa-inventory-projection.spec.ts`:

```ts
import { shouldManageMedusaInventoryForSellableProjection } from './medusa-inventory-projection';

describe('shouldManageMedusaInventoryForSellableProjection', () => {
  it('keeps manual out-of-stock stock-gated so Medusa projects zero managed inventory', () => {
    expect(
      shouldManageMedusaInventoryForSellableProjection({
        reason: 'MANUAL_OUT_OF_STOCK',
        isSellable: false,
      }),
    ).toBe(true);
  });

  it('keeps matching-missing non-stock-gated for unresolved variants', () => {
    expect(
      shouldManageMedusaInventoryForSellableProjection({
        reason: 'MATCHING_MISSING',
        isSellable: false,
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the new test and verify current behavior**

Run:

```bash
yarn test --testPathPattern=packages/domain-types/medusa-inventory-projection.spec.ts --runInBand
```

Expected: the first test should already pass because unknown reasons are stock-gated. This test is still required to prevent future accidental addition of `MANUAL_OUT_OF_STOCK` to `NON_STOCK_GATED_REASONS`.

- [ ] **Step 3: Add the DB schema field**

In `apps/core/src/modules/inventory/schema/inventory.schema.ts`, update `salesVariantPolicies`:

```ts
export const salesVariantPolicies = pgTable('sales_variant_policies', {
  variantId: uuid('variant_id').primaryKey(),
  inventoryManagement: boolean('inventory_management').notNull().default(false),
  preStockSellable: boolean('pre_stock_sellable').notNull().default(false),
  alwaysSellableZeroStock: boolean('always_sellable_zero_stock').notNull().default(false),
  availabilityOverride: varchar('availability_override', { length: 32 }).$type<'manual_out_of_stock' | null>(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Add the migration**

Create `apps/core/drizzle/20260615120000_add-availability-override-to-sales-variant-policies.sql`:

```sql
ALTER TABLE "sales_variant_policies"
ADD COLUMN "availability_override" varchar(32);
```

- [ ] **Step 5: Add event reason support**

In `packages/event-contracts/streams/inventory.stream.ts`, update `ProductSellableQuantityReason`:

```ts
export type ProductSellableQuantityReason =
  | 'SELLABLE'
  | 'PRE_STOCK_SELLABLE'
  | 'ALWAYS_SELLABLE_ZERO_STOCK'
  | 'MANUAL_OUT_OF_STOCK'
  | 'NOT_ACTIVE_VERSION'
  | 'VARIANT_INACTIVE'
  | 'SALES_NOT_STARTED'
  | 'SALES_ENDED'
  | 'MATCHING_MISSING'
  | 'MATCHING_PENDING'
  | 'MATCHING_IGNORED'
  | 'MATCHING_STRATEGY_UNSUPPORTED'
  | 'MATCHING_LINK_MISSING'
  | 'INSUFFICIENT_COMPONENT_STOCK';
```

Also add `'MANUAL_OUT_OF_STOCK'` to the `ProductSellableQuantityChangedSchema` reason enum in the same file.

- [ ] **Step 6: Verify schema and domain test**

Run:

```bash
yarn test --testPathPattern=packages/domain-types/medusa-inventory-projection.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/inventory/schema/inventory.schema.ts apps/core/drizzle/20260615120000_add-availability-override-to-sales-variant-policies.sql packages/event-contracts/streams/inventory.stream.ts packages/domain-types/medusa-inventory-projection.ts packages/domain-types/medusa-inventory-projection.spec.ts
git commit -m "feat: add manual stock override schema"
```

## Task 2: Product Sellable Quantity Calculator Override

**Files:**
- Modify: `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.calculator.ts`
- Modify: `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.calculator.spec.ts`
- Modify: `apps/core/src/modules/inventory/product-sellable-quantity/dto/product-sellable-quantity.dto.ts`

- [ ] **Step 1: Add failing calculator tests**

Append these tests inside `describe('calculateProductSellableQuantity', ...)` before the payload test:

```ts
  it('manual out-of-stock override projects zero even without matching or SKU links', () => {
    const result = calculateProductSellableQuantity(
      makeInput({
        matching: null,
        components: [],
        availabilityOverride: 'manual_out_of_stock',
      }),
      { now },
    );

    expect(result.sellableQuantity).toBe(0);
    expect(result.stockBoundQuantity).toBe(0);
    expect(result.isSellable).toBe(false);
    expect(result.reason).toBe('MANUAL_OUT_OF_STOCK');
    expect(result.availabilityOverride).toBe('manual_out_of_stock');
  });

  it('manual out-of-stock override wins over void strategy but not over inactive variant', () => {
    const voidResult = calculateProductSellableQuantity(
      makeInput({
        availabilityOverride: 'manual_out_of_stock',
        matching: {
          id: 'matching-1',
          status: 'matched',
          strategy: 'void',
          preStockSellable: true,
          alwaysSellableZeroStock: true,
        },
        components: [],
      }),
      { now },
    );

    expect(voidResult.sellableQuantity).toBe(0);
    expect(voidResult.isSellable).toBe(false);
    expect(voidResult.reason).toBe('MANUAL_OUT_OF_STOCK');

    const inactiveResult = calculateProductSellableQuantity(
      makeInput({
        variantStatus: 'inactive',
        availabilityOverride: 'manual_out_of_stock',
      }),
      { now },
    );

    expect(inactiveResult.reason).toBe('VARIANT_INACTIVE');
  });
```

- [ ] **Step 2: Run the calculator tests and verify failure**

Run:

```bash
yarn test --testPathPattern=apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.calculator.spec.ts --runInBand
```

Expected: FAIL because `availabilityOverride` and `MANUAL_OUT_OF_STOCK` are not yet in calculator types.

- [ ] **Step 3: Update calculator types and logic**

In `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.calculator.ts`, add:

```ts
export type ProductAvailabilityOverride = 'manual_out_of_stock' | null;
```

Add this field to `ProductSellableQuantityInput`:

```ts
  availabilityOverride?: ProductAvailabilityOverride;
```

Add this field to `ProductSellableQuantityResult`:

```ts
  availabilityOverride: ProductAvailabilityOverride;
```

Include it in `base`:

```ts
    availabilityOverride: input.availabilityOverride ?? null,
```

After the sales-period checks and before the `!input.matching` check, add:

```ts
  if (input.availabilityOverride === 'manual_out_of_stock') {
    return zero('MANUAL_OUT_OF_STOCK');
  }
```

Add `'MANUAL_OUT_OF_STOCK'` to `ProductSellableQuantityReason`.

- [ ] **Step 4: Include override in event payload and projection comparison**

In `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.ts`, update `toProductSellableQuantityChangedPayload`:

```ts
    availabilityOverride: projection.availabilityOverride,
```

Update `hasProductSellableQuantityProjectionChanged` only if the projection table stores the field. Do not compare it there for this iteration because the persisted projection state tracks `reason`, `sellableQuantity`, and `isSellable`; adding the field to projection storage is not required for Medusa behavior.

- [ ] **Step 5: Update DTO enum docs**

In `apps/core/src/modules/inventory/product-sellable-quantity/dto/product-sellable-quantity.dto.ts`, add `'MANUAL_OUT_OF_STOCK'` to the reason enum and add:

```ts
  @ApiProperty({ description: '수동 판매 가능 상태 override', enum: ['manual_out_of_stock'], nullable: true })
  availabilityOverride: 'manual_out_of_stock' | null;
```

- [ ] **Step 6: Run calculator tests**

Run:

```bash
yarn test --testPathPattern=apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.calculator.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.calculator.ts apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.calculator.spec.ts apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.ts apps/core/src/modules/inventory/product-sellable-quantity/dto/product-sellable-quantity.dto.ts
git commit -m "feat: calculate manual out of stock projection"
```

## Task 3: Load Sales Variant Policy Into Projection Calculation

**Files:**
- Modify: `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.ts`
- Modify: `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.spec.ts`

- [ ] **Step 1: Add a service test for policy override input**

In `apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.spec.ts`, add a test that stubs `getByVariantId` dependencies to include a `salesVariantPolicies` row with `availabilityOverride: 'manual_out_of_stock'` and expects `recalculateAndPublishForVariant` to enqueue a `ProductSellableQuantityChanged` payload with:

```ts
expect(params.payload).toMatchObject({
  variantId: projection.variantId,
  sellableQuantity: 0,
  stockBoundQuantity: 0,
  isSellable: false,
  reason: 'MANUAL_OUT_OF_STOCK',
  availabilityOverride: 'manual_out_of_stock',
});
```

Use the existing transaction stubs in the file; keep the test focused on the published payload.

- [ ] **Step 2: Run the service test and verify failure**

Run:

```bash
yarn test --testPathPattern=apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.spec.ts --runInBand
```

Expected: FAIL because `getByVariantIds` does not load `salesVariantPolicies`.

- [ ] **Step 3: Query sales variant policies**

In `ProductSellableQuantityService.getByVariantIds`, after `matchingRows`, add:

```ts
      const policyRows = await trx
        .select({
          variantId: wmsTables.salesVariantPolicies.variantId,
          availabilityOverride: wmsTables.salesVariantPolicies.availabilityOverride,
        })
        .from(wmsTables.salesVariantPolicies)
        .where(inArray(wmsTables.salesVariantPolicies.variantId, existingVariantIds));
```

Before building calculator input, add:

```ts
      const policyMap = new Map(policyRows.map((policy) => [policy.variantId, policy]));
```

Inside the map callback:

```ts
          const policy = policyMap.get(variantId);
```

Add to `ProductSellableQuantityInput`:

```ts
            availabilityOverride: policy?.availabilityOverride ?? null,
```

- [ ] **Step 4: Run service tests**

Run:

```bash
yarn test --testPathPattern=apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.ts apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.spec.ts
git commit -m "feat: feed variant availability override into projection"
```

## Task 4: Core Stock Policy API Persists The Override

**Files:**
- Modify: `apps/core/src/modules/product-matching/dto/resolve-matching.dto.ts`
- Modify: `apps/core/src/modules/product-matching/dto/upsert-matching.dto.ts`
- Modify: `apps/core/src/modules/inventory/core/dto/product-matching/resolve-matching.dto.ts`
- Modify: `apps/core/src/modules/product-matching/services/product-matching.service.ts`
- Modify: `apps/core/src/modules/product-matching/services/product-matching.service.spec.ts`

- [ ] **Step 1: Add DTO fields**

In each stock policy DTO, add:

```ts
  @ApiProperty({
    description: '수동 판매 가능 상태 override. manual_out_of_stock이면 노출은 유지하되 판매가능수량을 0으로 projection합니다.',
    required: false,
    nullable: true,
    enum: ['manual_out_of_stock'],
  })
  @IsOptional()
  @IsEnum(['manual_out_of_stock'])
  availabilityOverride?: 'manual_out_of_stock' | null;
```

Add `IsEnum` to imports where missing.

- [ ] **Step 2: Add service tests**

In `apps/core/src/modules/product-matching/services/product-matching.service.spec.ts`, add:

```ts
  it('updates sales variant policy override and recalculates projection', async () => {
    const { service, productSellableQuantity } = makeService();
    const tx = makeTx([[matching]]);

    const result = await service.updateStockPolicy(
      matching.id,
      {
        preStockSellable: false,
        alwaysSellableZeroStock: false,
        availabilityOverride: 'manual_out_of_stock',
      },
      tx as never,
    );

    expect(tx.updates[0]).toMatchObject({
      preStockSellable: false,
      alwaysSellableZeroStock: false,
      updatedAt: expect.any(Date),
    });
    expect(tx.inserts[0]).toMatchObject({
      variantId: matching.variantId,
      inventoryManagement: true,
      preStockSellable: false,
      alwaysSellableZeroStock: false,
      availabilityOverride: 'manual_out_of_stock',
    });
    expect(productSellableQuantity.recalculateAndPublishForVariant).toHaveBeenCalledWith(matching.variantId, tx);
    expect(result).toMatchObject({ id: matching.id });
  });
```

Extend the `makeTx().insert(...).values(...).onConflictDoUpdate(...)` stub so the insert builder records upsert values and resolves without throwing.

- [ ] **Step 3: Run the service test and verify failure**

Run:

```bash
yarn test --testPathPattern=apps/core/src/modules/product-matching/services/product-matching.service.spec.ts --runInBand
```

Expected: FAIL because `updateStockPolicy` only updates `product_matchings`.

- [ ] **Step 4: Persist override to sales variant policy**

In `ProductMatchingService.updateStockPolicy`, keep the existing `product_matchings` update for the two matching policy booleans. Then upsert `salesVariantPolicies`:

```ts
    await this.inTx(
      async (trx) =>
        trx
          .insert(wmsTables.salesVariantPolicies)
          .values({
            variantId: updated.variantId,
            inventoryManagement: true,
            preStockSellable: stockPolicy.preStockSellable ?? updated.preStockSellable,
            alwaysSellableZeroStock: stockPolicy.alwaysSellableZeroStock ?? updated.alwaysSellableZeroStock,
            availabilityOverride: stockPolicy.availabilityOverride ?? null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: wmsTables.salesVariantPolicies.variantId,
            set: {
              inventoryManagement: true,
              preStockSellable: stockPolicy.preStockSellable ?? updated.preStockSellable,
              alwaysSellableZeroStock: stockPolicy.alwaysSellableZeroStock ?? updated.alwaysSellableZeroStock,
              availabilityOverride: stockPolicy.availabilityOverride ?? null,
              updatedAt: new Date(),
            },
          }),
      tx,
    );
```

If this creates nested transactions with the existing `inTx`, refactor inside the same transaction callback rather than opening a second transaction.

- [ ] **Step 5: Return override from stock policy reads**

In `getStockPolicyForVariant`, query `salesVariantPolicies` by `variantId`. Return:

```ts
    return {
      preStockSellable: matching.preStockSellable,
      alwaysSellableZeroStock: matching.alwaysSellableZeroStock,
      availabilityOverride: policy?.availabilityOverride ?? null,
    };
```

If there is no matching but there is a policy row, return the policy booleans and override. This makes SKU-unmatched manual out-of-stock readable.

- [ ] **Step 6: Run product matching tests**

Run:

```bash
yarn test --testPathPattern=apps/core/src/modules/product-matching/services/product-matching.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/core/src/modules/product-matching/dto/resolve-matching.dto.ts apps/core/src/modules/product-matching/dto/upsert-matching.dto.ts apps/core/src/modules/inventory/core/dto/product-matching/resolve-matching.dto.ts apps/core/src/modules/product-matching/services/product-matching.service.ts apps/core/src/modules/product-matching/services/product-matching.service.spec.ts
git commit -m "feat: persist manual availability override"
```

## Task 5: Admin UI Toggle

**Files:**
- Modify: `apps/admin-web/src/lib/types/dto/matching.ts`
- Modify: `apps/admin-web/src/lib/services/matching/transformers.ts`
- Modify: `apps/admin-web/src/features/matching/products/components/variant-editor-dialog/stock-policy-section.tsx`
- Modify: `apps/admin-web/src/features/matching/products/components/variant-editor-dialog/index.tsx`
- Modify: `apps/admin-web/src/features/matching/variants/components/editor-dialog/index.tsx`

- [ ] **Step 1: Update admin DTO types**

In `apps/admin-web/src/lib/types/dto/matching.ts`, add:

```ts
export type AvailabilityOverride = 'manual_out_of_stock' | null;
```

Update `StockPolicyDto`:

```ts
export interface StockPolicyDto {
  preStockSellable: boolean;
  alwaysSellableZeroStock: boolean;
  availabilityOverride?: AvailabilityOverride;
}
```

- [ ] **Step 2: Update default policy**

In `apps/admin-web/src/lib/services/matching/transformers.ts`, update:

```ts
export const createDefaultStockPolicy = (): StockPolicyDto => ({
  preStockSellable: true,
  alwaysSellableZeroStock: false,
  availabilityOverride: null,
});
```

- [ ] **Step 3: Add the manual sold-out checkbox**

In `stock-policy-section.tsx`, add helper:

```tsx
  const setManualOutOfStock = (checked: boolean) => {
    onChange({
      ...value,
      availabilityOverride: checked ? 'manual_out_of_stock' : null,
    });
  };
```

Add this checkbox after the existing two policy checkboxes:

```tsx
        <div className="flex items-center gap-2">
          <Checkbox
            id="manualOutOfStock"
            checked={value.availabilityOverride === 'manual_out_of_stock'}
            onCheckedChange={(c) => setManualOutOfStock(!!c)}
          />
          <Label htmlFor="manualOutOfStock" className="cursor-pointer text-sm">
            수동 품절 (노출 유지, 판매 재고 0)
          </Label>
        </div>
```

- [ ] **Step 4: Normalize fetched policy before comparing**

In both editor dialogs, when setting policy from `current` or `matching`, ensure:

```ts
      setStockPolicy({
        ...createDefaultStockPolicy(),
        ...(current.stockPolicy ?? {}),
        availabilityOverride: current.stockPolicy?.availabilityOverride ?? null,
      });
```

Use the same pattern for `matching.stockPolicy`.

- [ ] **Step 5: Run admin lint/type checks**

Run:

```bash
yarn lint:admin-web
```

Expected: PASS or only pre-existing lint warnings unrelated to touched files.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/lib/types/dto/matching.ts apps/admin-web/src/lib/services/matching/transformers.ts apps/admin-web/src/features/matching/products/components/variant-editor-dialog/stock-policy-section.tsx apps/admin-web/src/features/matching/products/components/variant-editor-dialog/index.tsx apps/admin-web/src/features/matching/variants/components/editor-dialog/index.tsx
git commit -m "feat: add admin manual sold out toggle"
```

## Task 6: End-To-End Verification

**Files:**
- No new files unless fixing failures found by verification.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
yarn test --testPathPattern=apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.calculator.spec.ts --runInBand
yarn test --testPathPattern=apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.spec.ts --runInBand
yarn test --testPathPattern=apps/core/src/modules/product-matching/services/product-matching.service.spec.ts --runInBand
yarn test --testPathPattern=packages/domain-types/medusa-inventory-projection.spec.ts --runInBand
```

Expected: all PASS.

- [ ] **Step 2: Run builds**

Run:

```bash
yarn build:core
yarn build:admin-web
```

Expected: both PASS.

- [ ] **Step 3: Manual API smoke test in local dev**

With Core running, set manual out of stock:

```bash
export MATCHING_ID="11111111-1111-1111-1111-111111111111"
curl -X PATCH "http://localhost:3000/matchings/${MATCHING_ID}/stock-policy" \
  -H "Content-Type: application/json" \
  -d '{
    "preStockSellable": false,
    "alwaysSellableZeroStock": false,
    "availabilityOverride": "manual_out_of_stock"
  }'
```

Expected: response includes the updated matching or stock policy; Core logs show projection recalculation for the variant.

- [ ] **Step 4: Manual product behavior check**

In admin:

1. Open `매칭 > Variant`.
2. Open a variant with no SKU links or a `void` strategy.
3. Enable `수동 품절 (노출 유지, 판매 재고 0)`.
4. Save.
5. Confirm storefront product remains visible.
6. Try checkout or cart completion.

Expected: Medusa receives a `ProductSellableQuantityChanged` reason `MANUAL_OUT_OF_STOCK`, projects managed inventory quantity `0`, and checkout fails with out-of-stock behavior.

- [ ] **Step 5: Final commit for verification fixes if needed**

If verification required fixes:

```bash
git status --short
git add apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.calculator.ts apps/core/src/modules/inventory/product-sellable-quantity/services/product-sellable-quantity.service.ts apps/core/src/modules/product-matching/services/product-matching.service.ts apps/admin-web/src/features/matching/products/components/variant-editor-dialog/stock-policy-section.tsx
git commit -m "fix: verify manual sold out projection"
```

If the files changed during verification differ from the `git add` list above, replace the `git add` command with the exact changed files shown by `git status --short`. If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: Covers no-SKU/no-matching manual sold out, visible product semantics, Medusa zero managed inventory projection, admin toggle, backend API, and tests.
- Placeholder scan: No TBD/TODO markers remain. Manual smoke test uses an explicit sample UUID and instructs the executor to set `MATCHING_ID` for their environment.
- Type consistency: The override value is consistently named `availabilityOverride` with value `'manual_out_of_stock'`; event reason is consistently `MANUAL_OUT_OF_STOCK`.
- Scope check: This plan does not add product hiding, bulk actions, audit UI, or scheduled override expiration beyond the existing `effectiveFrom/effectiveTo` fields. Those are separate enhancements.
