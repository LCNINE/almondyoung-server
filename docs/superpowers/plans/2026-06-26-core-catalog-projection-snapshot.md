# Core Catalog Projection Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Core Catalog's active sales-channel projection snapshot from the admin version detail read model, then route active publish/resync events through the new projection assembler.

**Architecture:** Add a neutral `ProductVersionReadLoader` for version-owned DB facts, keep `ProductReadAssembler` responsible for admin DTO shape, and add `ProjectionSnapshotAssembler` for the active-only `ProductSnapshot` contract. `ProductVersionsService` remains the workflow orchestrator: it validates and refreshes price projection, flips active status inside the transaction, asks the assembler for a `ProjectionSnapshotAssembly`, and enqueues the outbox event with caller-owned metadata.

**Tech Stack:** NestJS, Drizzle ORM, PostgreSQL, Jest, `@packages/event-contracts`, channel-adapter Medusa transformer.

---

## File Structure

- Create: `apps/core/src/modules/catalog/core/products/loaders/product-version-read.loader.ts`  
  Neutral DB-fact loader for version row, active version row, version-scoped categories, variants, images, and purchase constraint.
- Create: `apps/core/src/modules/catalog/core/products/loaders/product-version-read.loader.spec.ts`  
  Unit tests for version scoping, `isPrimary`, active tag-independent neutrality, image sorting, variant option id capture, and nullable purchase constraint.
- Create: `apps/core/src/modules/catalog/core/products/assemblers/projection-snapshot.assembler.ts`  
  Active-only sales-channel `ProductSnapshot` assembler returning `ProjectionSnapshotAssembly`.
- Create: `apps/core/src/modules/catalog/core/products/assemblers/projection-snapshot.assembler.spec.ts`  
  Unit tests for active-only validation, zero active variants, price cache requiredness, option display requiredness, UUID image fields, active-variant filtering, category primary validation, and optionless products.
- Modify: `apps/core/src/modules/catalog/core/products/assemblers/product-read.assembler.ts`  
  Replace overlapping private queries with `ProductVersionReadLoader` while preserving `ProductDetailDto`.
- Create: `apps/core/src/modules/catalog/core/products/assemblers/product-read.assembler.spec.ts`  
  Focused regression tests that admin detail shape is preserved after loader extraction.
- Modify: `apps/core/src/modules/catalog/core/pricing/variant-price-cache.service.ts`  
  Change publish-time price materialization from insert-only to upsert-refresh.
- Create: `apps/core/src/modules/catalog/core/pricing/variant-price-cache.service.spec.ts`  
  Unit test for conflict update of existing cache rows.
- Modify: `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts`  
  Inject `ProjectionSnapshotAssembler`, reorder publish side effects, pass explicit `changeReason`, remove private snapshot builder helpers.
- Modify: `apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts`  
  Update constructor mocks and add publish/event orchestration tests.
- Modify: `apps/core/src/modules/catalog/core/products/products.module.ts`  
  Register the new loader and assembler in `providers`. Keep them module-local unless a later task introduces an external consumer.
- Modify: `apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.spec.ts`  
  Cover `thumbnail` and `images[].url` carrying File UUIDs.

Out of scope for this plan: approval and bulk active-transition bypasses, storefront direct URL consumers, and event-contract reason enum expansion.

---

### Task 1: Product Version Read Loader

**Files:**
- Create: `apps/core/src/modules/catalog/core/products/loaders/product-version-read.loader.ts`
- Create: `apps/core/src/modules/catalog/core/products/loaders/product-version-read.loader.spec.ts`

- [ ] **Step 1: Write failing loader tests**

Create `apps/core/src/modules/catalog/core/products/loaders/product-version-read.loader.spec.ts` with these behaviors:

```ts
import { ProductVersionReadLoader } from './product-version-read.loader';
import {
  productImages,
  productMasterCategories,
  productMasterPurchaseConstraints,
  productMasterVariants,
  productMasterVersions,
  productPurchaseConstraints,
  productVariants,
  variantOptionValues,
} from '../../../schema/catalog.schema';

type SelectFixtures = {
  versions?: Array<Record<string, unknown>>;
  categories?: Array<Record<string, unknown> & { showOnMainCategory?: boolean }>;
  variants?: Array<Record<string, unknown> & { id: string; optionValueIds?: string[] }>;
  images?: Array<Record<string, unknown>>;
  purchaseConstraint?: Record<string, unknown> | null;
};

function promiseTerminal<T>(rows: T[]) {
  const promise = Promise.resolve(rows);
  return {
    orderBy: jest.fn(() => promise),
    limit: jest.fn(() => promise),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
    [Symbol.toStringTag]: 'Promise',
  };
}

function makeSelectTx(fixtures: SelectFixtures) {
  const variantRows = (fixtures.variants ?? []).map(({ optionValueIds: _optionValueIds, ...variant }) => ({
    product_variants: variant,
  }));
  const optionRows = (fixtures.variants ?? []).flatMap((variant) =>
    (variant.optionValueIds ?? []).map((optionValueId) => ({
      variantId: variant.id,
      optionValueId,
    })),
  );
  const categoryRows = (fixtures.categories ?? []).map((category) => ({
    ...category,
    displaySettings: { showOnMainCategory: category.showOnMainCategory ?? false },
  }));
  const purchaseConstraintRows = fixtures.purchaseConstraint ? [fixtures.purchaseConstraint] : [];

  const rowsForTable = (table: unknown) => {
    if (table === productMasterVersions) return fixtures.versions ?? [];
    if (table === productMasterCategories) return categoryRows;
    if (table === productMasterVariants) return variantRows;
    if (table === variantOptionValues) return optionRows;
    if (table === productImages) return fixtures.images ?? [];
    if (table === productMasterPurchaseConstraints) return purchaseConstraintRows;
    if (table === productPurchaseConstraints) return purchaseConstraintRows;
    if (table === productVariants) return variantRows;
    return [];
  };

  return {
    select: jest.fn(() => ({
      from: jest.fn((table: unknown) => {
        const rows = rowsForTable(table);
        const chain: any = {
          innerJoin: jest.fn(() => chain),
          where: jest.fn(() => promiseTerminal(rows)),
          orderBy: jest.fn(() => Promise.resolve(rows)),
          limit: jest.fn(() => Promise.resolve(rows)),
        };
        return chain;
      }),
    })),
  };
}

describe('ProductVersionReadLoader', () => {
  it('loads categories scoped by masterId and versionId and preserves isPrimary', async () => {
    const loader = new ProductVersionReadLoader();
    const tx = makeSelectTx({
      categories: [
        {
          id: 'cat-active-primary',
          name: 'Lip',
          slug: 'lip',
          path: '/makeup/lip',
          parentId: 'cat-makeup',
          isActive: true,
          visibility: true,
          showOnMainCategory: true,
          thumbnailFileId: 'file-cat-1',
          isPrimary: true,
        },
      ],
    });

    await expect(loader.getCategories(tx as any, 'master-1', 'version-2')).resolves.toEqual([
      {
        id: 'cat-active-primary',
        name: 'Lip',
        slug: 'lip',
        path: '/makeup/lip',
        parentId: 'cat-makeup',
        isActive: true,
        visibility: true,
        showOnMainCategory: true,
        thumbnailFileId: 'file-cat-1',
        isPrimary: true,
      },
    ]);
  });

  it('loads variants as neutral facts and includes raw option value ids', async () => {
    const loader = new ProductVersionReadLoader();
    const tx = makeSelectTx({
      variants: [
        {
          id: 'variant-1',
          variantName: 'Red',
          variantCode: 'AY-RED',
          isDefault: false,
          status: 'active',
          displayOrder: 10,
          optionValueIds: ['value-red'],
        },
        {
          id: 'variant-2',
          variantName: 'Blue',
          variantCode: 'AY-BLUE',
          isDefault: false,
          status: 'inactive',
          displayOrder: 20,
          optionValueIds: ['value-blue'],
        },
      ],
    });

    await expect(loader.getVariants(tx as any, 'master-1', 'version-2')).resolves.toEqual([
      expect.objectContaining({ id: 'variant-1', status: 'active', optionValueIds: ['value-red'] }),
      expect.objectContaining({ id: 'variant-2', status: 'inactive', optionValueIds: ['value-blue'] }),
    ]);
  });

  it('loads product images sorted with primary image first and raw File UUIDs only', async () => {
    const loader = new ProductVersionReadLoader();
    const tx = makeSelectTx({
      images: [
        { id: 'img-1', versionId: 'version-2', fileId: 'file-primary', isPrimary: true, sortOrder: 10 },
        { id: 'img-2', versionId: 'version-2', fileId: 'file-secondary', isPrimary: false, sortOrder: 20 },
      ],
    });

    await expect(loader.getImages(tx as any, 'version-2')).resolves.toEqual([
      expect.objectContaining({ fileId: 'file-primary', isPrimary: true }),
      expect.objectContaining({ fileId: 'file-secondary', isPrimary: false }),
    ]);
  });

  it('returns null when no purchase constraint mapping exists', async () => {
    const loader = new ProductVersionReadLoader();
    const tx = makeSelectTx({ purchaseConstraint: null });

    await expect(loader.getPurchaseConstraint(tx as any, 'master-1', 'version-2')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the loader test and confirm RED**

Run:

```bash
yarn jest apps/core/src/modules/catalog/core/products/loaders/product-version-read.loader.spec.ts --runInBand
```

Expected: FAIL because `ProductVersionReadLoader` does not exist.

- [ ] **Step 3: Add the neutral loader**

Create `apps/core/src/modules/catalog/core/products/loaders/product-version-read.loader.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  DbTransaction,
  ProductImage,
  ProductMasterVersion,
  ProductVariant,
  PurchaseConstraintReadModel,
} from '../../../catalog.types';
import {
  productCategories,
  productImages,
  productMasterCategories,
  productMasterPurchaseConstraints,
  productMasterVariants,
  productMasterVersions,
  productMasters,
  productPurchaseConstraints,
  productVariants,
  variantOptionValues,
} from '../../../schema/catalog.schema';

export type ProductVersionCategoryFragment = {
  id: string;
  name: string;
  slug: string;
  path: string;
  parentId: string | null;
  isActive: boolean;
  visibility: boolean;
  showOnMainCategory: boolean;
  thumbnailFileId: string | null;
  isPrimary: boolean;
};

export type ProductVersionVariantFragment = ProductVariant & {
  optionValueIds: string[];
};

@Injectable()
export class ProductVersionReadLoader {
  async getVersionById(tx: DbTransaction, versionId: string): Promise<ProductMasterVersion> {
    const [version] = await tx.select().from(productMasterVersions).where(eq(productMasterVersions.id, versionId)).limit(1);
    if (!version) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }
    return version;
  }

  async getActiveVersion(tx: DbTransaction, masterId: string): Promise<ProductMasterVersion> {
    const result = await tx
      .select()
      .from(productMasterVersions)
      .innerJoin(productMasters, eq(productMasterVersions.masterId, productMasters.id))
      .where(
        and(
          eq(productMasterVersions.masterId, masterId),
          eq(productMasterVersions.status, 'active'),
          isNull(productMasters.deletedAt),
        ),
      )
      .limit(1);

    if (result.length === 0) {
      throw new NotFoundException(`No active version found for master ${masterId}`);
    }
    return result[0].product_master_versions;
  }

  async getCategories(
    tx: DbTransaction,
    masterId: string,
    versionId: string,
  ): Promise<ProductVersionCategoryFragment[]> {
    const rows = await tx
      .select({
        id: productCategories.id,
        name: productCategories.name,
        slug: productCategories.slug,
        path: productCategories.path,
        parentId: productCategories.parentId,
        isActive: productCategories.isActive,
        visibility: productCategories.visibility,
        displaySettings: productCategories.displaySettings,
        thumbnailFileId: productCategories.imageUrl,
        isPrimary: productMasterCategories.isPrimary,
      })
      .from(productMasterCategories)
      .innerJoin(productCategories, eq(productMasterCategories.categoryId, productCategories.id))
      .where(and(eq(productMasterCategories.masterId, masterId), eq(productMasterCategories.versionId, versionId)))
      .orderBy(desc(productMasterCategories.isPrimary), asc(productCategories.path), asc(productCategories.name));

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      path: row.path,
      parentId: row.parentId,
      isActive: row.isActive,
      visibility: row.visibility,
      showOnMainCategory: row.displaySettings?.showOnMainCategory ?? false,
      thumbnailFileId: row.thumbnailFileId,
      isPrimary: row.isPrimary,
    }));
  }

  async getVariants(tx: DbTransaction, masterId: string, versionId: string): Promise<ProductVersionVariantFragment[]> {
    const rows = await tx
      .select()
      .from(productMasterVariants)
      .innerJoin(productVariants, eq(productMasterVariants.variantId, productVariants.id))
      .where(and(eq(productMasterVariants.masterId, masterId), eq(productMasterVariants.versionId, versionId)))
      .orderBy(asc(productVariants.displayOrder));

    const variants = rows.map((row) => row.product_variants);
    if (variants.length === 0) {
      return [];
    }

    const variantIds = variants.map((variant) => variant.id);
    const optionRows = await tx
      .select({
        variantId: variantOptionValues.variantId,
        optionValueId: variantOptionValues.optionValueId,
      })
      .from(variantOptionValues)
      .where(inArray(variantOptionValues.variantId, variantIds));

    const optionValueIdsByVariant = new Map<string, string[]>();
    for (const variantId of variantIds) {
      optionValueIdsByVariant.set(variantId, []);
    }
    for (const row of optionRows) {
      optionValueIdsByVariant.get(row.variantId)?.push(row.optionValueId);
    }

    return variants.map((variant) => ({
      ...variant,
      optionValueIds: optionValueIdsByVariant.get(variant.id) ?? [],
    }));
  }

  async getImages(tx: DbTransaction, versionId: string): Promise<ProductImage[]> {
    return tx
      .select()
      .from(productImages)
      .where(eq(productImages.versionId, versionId))
      .orderBy(desc(productImages.isPrimary), asc(productImages.sortOrder));
  }

  async getPurchaseConstraint(
    tx: DbTransaction,
    masterId: string,
    versionId: string,
  ): Promise<PurchaseConstraintReadModel | null> {
    const [row] = await tx
      .select({
        id: productPurchaseConstraints.id,
        requiresMembership: productPurchaseConstraints.requiresMembership,
        lifetimeQuantityLimit: productPurchaseConstraints.lifetimeQuantityLimit,
      })
      .from(productMasterPurchaseConstraints)
      .innerJoin(
        productPurchaseConstraints,
        eq(productMasterPurchaseConstraints.purchaseConstraintId, productPurchaseConstraints.id),
      )
      .where(
        and(
          eq(productMasterPurchaseConstraints.masterId, masterId),
          eq(productMasterPurchaseConstraints.versionId, versionId),
        ),
      )
      .limit(1);

    return row ?? null;
  }
}
```

- [ ] **Step 4: Run the loader test and confirm GREEN**

Run:

```bash
yarn jest apps/core/src/modules/catalog/core/products/loaders/product-version-read.loader.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/loaders/product-version-read.loader.ts apps/core/src/modules/catalog/core/products/loaders/product-version-read.loader.spec.ts
git commit -m "[catalog] add product version read loader"
```

---

### Task 2: Admin Detail Reads Use Shared Loader

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/assemblers/product-read.assembler.ts`
- Create: `apps/core/src/modules/catalog/core/products/assemblers/product-read.assembler.spec.ts`
- Modify: `apps/core/src/modules/catalog/core/products/products.module.ts`

- [ ] **Step 1: Write admin detail regression tests**

Create `apps/core/src/modules/catalog/core/products/assemblers/product-read.assembler.spec.ts`:

```ts
import { ProductReadAssembler } from './product-read.assembler';

describe('ProductReadAssembler shared loader integration', () => {
  it('preserves admin version detail shape while reading fragments from ProductVersionReadLoader', async () => {
    const versionLoader = {
      getVersionById: jest.fn().mockResolvedValue({
        id: 'version-1',
        masterId: 'master-1',
        version: 1,
        status: 'active',
        name: 'Tint',
      }),
      getVariants: jest.fn().mockResolvedValue([
        {
          id: 'variant-1',
          variantName: 'Red',
          status: 'active',
          isDefault: true,
          optionValueIds: [],
        },
      ]),
      getImages: jest.fn().mockResolvedValue([
        { id: 'image-1', versionId: 'version-1', fileId: 'file-primary', isPrimary: true, sortOrder: 1 },
      ]),
      getCategories: jest.fn().mockResolvedValue([
        {
          id: 'category-1',
          name: 'Lip',
          slug: 'lip',
          path: '/lip',
          parentId: null,
          isActive: true,
          visibility: true,
          showOnMainCategory: false,
          thumbnailFileId: null,
          isPrimary: true,
        },
      ]),
      getPurchaseConstraint: jest.fn().mockResolvedValue({
        id: 'constraint-1',
        requiresMembership: true,
        lifetimeQuantityLimit: 3,
      }),
    };
    const priceCacheService = {
      getCachedPriceSetsByVersion: jest.fn().mockResolvedValue([
        { variantId: 'variant-1', basePrice: 10000, membershipPrice: 9000, tieredPrices: [] },
      ]),
      getPriceSummariesByVersionIds: jest.fn().mockResolvedValue(new Map([['version-1', { minBasePrice: 10000 }]])),
    };
    const optionReadLoader = {
      getOptionGroups: jest.fn().mockResolvedValue([]),
      getVariantOptionValues: jest.fn().mockResolvedValue([]),
    };
    const tagReadLoader = { getTags: jest.fn().mockResolvedValue([]) };
    const assembler = new ProductReadAssembler(
      { db: { transaction: jest.fn() } } as any,
      priceCacheService as any,
      optionReadLoader as any,
      tagReadLoader as any,
      versionLoader as any,
    );

    const detail = await assembler.getVersionDetail('version-1', undefined, {} as any);

    expect(detail.thumbnail).toBe('file-primary');
    expect(detail.categories).toEqual([
      { id: 'category-1', name: 'Lip', slug: 'lip', path: '/lip', parentId: null, isActive: true, isPrimary: true },
    ]);
    expect(detail.variants[0]).toEqual(
      expect.objectContaining({
        id: 'variant-1',
        price: 10000,
        priceSet: { basePrice: 10000, membershipPrice: 9000, tieredPrices: [] },
      }),
    );
    expect(detail.purchaseConstraint).toEqual({
      id: 'constraint-1',
      requiresMembership: true,
      lifetimeQuantityLimit: 3,
    });
  });
});
```

- [ ] **Step 2: Run the admin detail test and confirm RED**

Run:

```bash
yarn jest apps/core/src/modules/catalog/core/products/assemblers/product-read.assembler.spec.ts --runInBand
```

Expected: FAIL because `ProductReadAssembler` does not inject `ProductVersionReadLoader`.

- [ ] **Step 3: Refactor `ProductReadAssembler` to use the loader**

Modify the constructor:

```ts
constructor(
  @InjectDb() private readonly db: DbService<PimSchema>,
  private readonly priceCacheService: VariantPriceCacheService,
  private readonly optionReadLoader: OptionReadLoader,
  private readonly tagReadLoader: TagReadLoader,
  private readonly versionReadLoader: ProductVersionReadLoader,
) {}
```

Replace the overlapping reads in `getVersionDetail`:

```ts
const version = await this.versionReadLoader.getVersionById(tx, versionId);
const masterId = version.masterId;

const variantsPromise = include.variants
  ? this.versionReadLoader.getVariants(tx, masterId, versionId)
  : Promise.resolve([]);
const imagesPromise = include.images ? this.versionReadLoader.getImages(tx, versionId) : Promise.resolve([]);
const categoryFragmentsPromise = include.categories
  ? this.versionReadLoader.getCategories(tx, masterId, versionId)
  : Promise.resolve([]);
const purchaseConstraintPromise = this.versionReadLoader.getPurchaseConstraint(tx, masterId, versionId);
```

Map loader category fragments back to the existing admin category DTO:

```ts
const categories: ProductDetailCategory[] = categoryFragments.map((category) => ({
  id: category.id,
  name: category.name,
  slug: category.slug,
  path: category.path,
  parentId: category.parentId,
  isActive: category.isActive,
  isPrimary: category.isPrimary,
}));
```

Keep `getPrimaryImagesByVersionIds` as-is for list callers, and delete only the private helpers replaced by the new loader: `getVersionById`, `_fetchVariants`, `_fetchImages`, `_fetchCategories`, and `_fetchPurchaseConstraint`. Use `versionReadLoader.getActiveVersion` inside `getMasterDetail` and remove the private `getActiveVersion` helper if no remaining caller uses it.

- [ ] **Step 4: Register the loader in `ProductsModule`**

Modify `apps/core/src/modules/catalog/core/products/products.module.ts`:

```ts
import { ProductVersionReadLoader } from './loaders/product-version-read.loader';
```

Add `ProductVersionReadLoader` to `providers`. Export it only if another module imports it directly; for this slice, keeping it provider-only inside `ProductsModule` is enough.

- [ ] **Step 5: Run the admin detail test and existing product tests**

Run:

```bash
yarn jest apps/core/src/modules/catalog/core/products/assemblers/product-read.assembler.spec.ts --runInBand
yarn jest apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts --runInBand
```

Expected: PASS after updating any `ProductReadAssembler` constructor call sites in tests.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/assemblers/product-read.assembler.ts apps/core/src/modules/catalog/core/products/assemblers/product-read.assembler.spec.ts apps/core/src/modules/catalog/core/products/products.module.ts
git commit -m "[catalog] route admin detail reads through version loader"
```

---

### Task 3: Price Cache Refresh On Publish

**Files:**
- Modify: `apps/core/src/modules/catalog/core/pricing/variant-price-cache.service.ts`
- Create: `apps/core/src/modules/catalog/core/pricing/variant-price-cache.service.spec.ts`

- [ ] **Step 1: Write failing price cache upsert test**

Create `apps/core/src/modules/catalog/core/pricing/variant-price-cache.service.spec.ts`:

```ts
import { VariantPriceCacheService } from './variant-price-cache.service';
import { productMasterVariants, productMasterVersions, productVariantPriceCache } from '../../schema/catalog.schema';

function makePromiseTerminal<T>(rows: T[]) {
  const promise = Promise.resolve(rows);
  return {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
    finally: promise.finally.bind(promise),
    [Symbol.toStringTag]: 'Promise',
  };
}

function makeCacheTx(callbacks: {
  onConflictDoUpdate: jest.Mock;
  onConflictDoNothing: jest.Mock;
}) {
  const rowsForTable = (table: unknown) => {
    if (table === productMasterVersions) return [{ id: 'version-1' }];
    if (table === productMasterVariants) return [{ variantId: 'variant-1' }];
    return [];
  };

  return {
    select: jest.fn(() => ({
      from: jest.fn((table: unknown) => ({
        where: jest.fn(() => makePromiseTerminal(rowsForTable(table))),
      })),
    })),
    insert: jest.fn((table: unknown) => {
      expect(table).toBe(productVariantPriceCache);
      return {
        values: jest.fn((values: unknown) => {
          expect(values).toEqual([
            expect.objectContaining({
              versionId: 'version-1',
              variantId: 'variant-1',
              basePrice: 12000,
              membershipPrice: 10000,
              tieredPrices: [{ minQuantity: 10, price: 9000 }],
            }),
          ]);
          return {
            onConflictDoUpdate: callbacks.onConflictDoUpdate,
            onConflictDoNothing: callbacks.onConflictDoNothing,
          };
        }),
      };
    }),
  };
}

describe('VariantPriceCacheService', () => {
  it('refreshes existing cache rows instead of ignoring conflicts', async () => {
    const onConflictDoUpdate = jest.fn().mockResolvedValue(undefined);
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    const tx = makeCacheTx({ onConflictDoUpdate, onConflictDoNothing });
    const calculatorService = {
      calculateVariantPriceSet: jest.fn().mockResolvedValue({
        basePrice: 12000,
        membershipPrice: 10000,
        tieredPrices: [{ minQuantity: 10, price: 9000 }],
      }),
    };
    const service = new VariantPriceCacheService({ db: { transaction: jest.fn() } } as any, calculatorService as any);

    await service.cachePricesForVersion('version-1', tx as any);

    expect(onConflictDoNothing).not.toHaveBeenCalled();
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: [productVariantPriceCache.versionId, productVariantPriceCache.variantId],
        set: expect.objectContaining({
          basePrice: expect.anything(),
          membershipPrice: expect.anything(),
          tieredPrices: expect.anything(),
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run the price cache test and confirm RED**

Run:

```bash
yarn jest apps/core/src/modules/catalog/core/pricing/variant-price-cache.service.spec.ts --runInBand
```

Expected: FAIL because the service calls `onConflictDoNothing`.

- [ ] **Step 3: Replace insert-only conflict handling with upsert refresh**

Modify `cachePricesForVersion`:

```ts
await trx
  .insert(productVariantPriceCache)
  .values(rows)
  .onConflictDoUpdate({
    target: [productVariantPriceCache.versionId, productVariantPriceCache.variantId],
    set: {
      basePrice: sql`excluded.base_price`,
      membershipPrice: sql`excluded.membership_price`,
      tieredPrices: sql`excluded.tiered_prices`,
      createdAt: sql`excluded.created_at`,
    },
  });
```

Keep the method name `cachePricesForVersion` so existing callers continue to compile, but document in the test name that publish-time cache materialization refreshes stale rows.

- [ ] **Step 4: Run the price cache test and confirm GREEN**

Run:

```bash
yarn jest apps/core/src/modules/catalog/core/pricing/variant-price-cache.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/core/src/modules/catalog/core/pricing/variant-price-cache.service.ts apps/core/src/modules/catalog/core/pricing/variant-price-cache.service.spec.ts
git commit -m "[catalog] refresh variant price cache on publish"
```

---

### Task 4: Projection Snapshot Assembler

**Files:**
- Create: `apps/core/src/modules/catalog/core/products/assemblers/projection-snapshot.assembler.ts`
- Create: `apps/core/src/modules/catalog/core/products/assemblers/projection-snapshot.assembler.spec.ts`
- Modify: `apps/core/src/modules/catalog/core/products/products.module.ts`

- [ ] **Step 1: Write failing assembler tests**

Create `apps/core/src/modules/catalog/core/products/assemblers/projection-snapshot.assembler.spec.ts` with these test cases:

```ts
import { BadRequestException } from '@nestjs/common';
import { ProjectionSnapshotAssembler } from './projection-snapshot.assembler';

type AssemblerFixtures = {
  version?: Record<string, unknown>;
  categories?: Array<Record<string, unknown>>;
  variants?: Array<Record<string, unknown> & { id: string; status?: string; optionValueIds?: string[] }>;
  images?: Array<Record<string, unknown>>;
  tags?: Array<Record<string, unknown>>;
  purchaseConstraint?: Record<string, unknown> | null;
  prices?: Array<Record<string, unknown>>;
  optionGroups?: Array<Record<string, unknown> & { id: string; values: Array<Record<string, unknown>> }>;
  variantOptionValuesByVariant?: Record<string, Array<Record<string, unknown>>>;
};

function makeAssembler(fixtures: AssemblerFixtures = {}) {
  const version = {
    id: 'version-1',
    masterId: 'master-1',
    version: 3,
    status: 'active',
    name: 'Lip Tint',
    description: null,
    descriptionHtml: null,
    seoTitle: null,
    seoDescription: null,
    seoKeywords: null,
    brand: null,
    productType: 'regular_sale',
    fulfillmentKind: 'physical',
    isWholesaleOnly: false,
    hideMembershipPriceForNonMembers: false,
    isMembershipOnly: false,
    isVisibleToMembersOnly: false,
    ...fixtures.version,
  };
  const categories = fixtures.categories ?? [];
  const variants =
    fixtures.variants ??
    [
      {
        id: 'variant-1',
        variantName: 'Default',
        variantCode: null,
        isDefault: true,
        status: 'active',
        optionValueIds: [],
      },
    ];
  const images = fixtures.images ?? [];
  const tags = fixtures.tags ?? [];
  const purchaseConstraint = fixtures.purchaseConstraint ?? null;
  const prices =
    fixtures.prices ??
    variants
      .filter((variant) => variant.status === 'active')
      .map((variant) => ({
        variantId: variant.id,
        basePrice: 10000,
        membershipPrice: 9000,
        tieredPrices: [],
      }));
  const optionGroups = fixtures.optionGroups ?? [];
  const variantOptionValuesByVariant = fixtures.variantOptionValuesByVariant ?? {};

  const versionReadLoader = {
    getVersionById: jest.fn().mockResolvedValue(version),
    getCategories: jest.fn().mockResolvedValue(categories),
    getVariants: jest.fn().mockResolvedValue(variants),
    getImages: jest.fn().mockResolvedValue(images),
    getPurchaseConstraint: jest.fn().mockResolvedValue(purchaseConstraint),
  };
  const optionReadLoader = {
    getOptionGroups: jest.fn().mockResolvedValue(optionGroups),
    getVariantOptionValues: jest.fn((_tx, variantId: string) =>
      Promise.resolve(variantOptionValuesByVariant[variantId] ?? []),
    ),
  };
  const tagReadLoader = { getTags: jest.fn().mockResolvedValue(tags) };
  const priceCacheService = { getCachedPriceSetsByVersion: jest.fn().mockResolvedValue(prices) };

  return new ProjectionSnapshotAssembler(
    versionReadLoader as any,
    optionReadLoader as any,
    tagReadLoader as any,
    priceCacheService as any,
  );
}

describe('ProjectionSnapshotAssembler', () => {
  it('fails when the version is not DB-visible active', async () => {
    const assembler = makeAssembler({ version: { status: 'draft' } });
    await expect(assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('fails when an active version has no active variants', async () => {
    const assembler = makeAssembler({ variants: [{ id: 'variant-1', status: 'inactive', optionValueIds: [] }] });
    await expect(assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any)).rejects.toThrow(
      'requires at least one active variant',
    );
  });

  it('fails when an active variant has no calculated price cache row', async () => {
    const assembler = makeAssembler({ prices: [] });
    await expect(assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any)).rejects.toThrow(
      'Missing calculated price cache',
    );
  });

  it('fails when active variant option display rows are missing for ko-KR', async () => {
    const assembler = makeAssembler({
      variants: [{ id: 'variant-1', status: 'active', isDefault: false, optionValueIds: ['value-red'] }],
      variantOptionValuesByVariant: { 'variant-1': [] },
    });
    await expect(assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any)).rejects.toThrow(
      'Missing option display',
    );
  });

  it('assembles active variants only and keeps thumbnail/images as File UUID values', async () => {
    const assembler = makeAssembler({
      variants: [
        { id: 'variant-active', status: 'active', variantName: 'Red', isDefault: true, optionValueIds: [] },
        { id: 'variant-inactive', status: 'inactive', variantName: 'Blue', isDefault: false, optionValueIds: [] },
      ],
      images: [
        { id: 'image-1', fileId: 'file-primary', isPrimary: true, sortOrder: 1 },
        { id: 'image-2', fileId: 'file-secondary', isPrimary: false, sortOrder: 2 },
      ],
    });

    const assembly = await assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any);

    expect(assembly.snapshot.status).toBe('active');
    expect(assembly.snapshot.thumbnail).toBe('file-primary');
    expect(assembly.snapshot.images).toEqual([
      { fileId: 'file-primary', url: 'file-primary', isPrimary: true, sortOrder: 1 },
      { fileId: 'file-secondary', url: 'file-secondary', isPrimary: false, sortOrder: 2 },
    ]);
    expect(assembly.snapshot.variants.map((variant) => variant.id)).toEqual(['variant-active']);
    expect(assembly.snapshot.optionGroups).toEqual([]);
    expect(assembly.snapshot.variants[0].optionCombination).toEqual([]);
  });

  it('emits only option groups and values used by active variants', async () => {
    const assembler = makeAssembler({
      variants: [
        { id: 'variant-red', status: 'active', variantName: 'Red', isDefault: false, optionValueIds: ['value-red'] },
        {
          id: 'variant-blue-inactive',
          status: 'inactive',
          variantName: 'Blue',
          isDefault: false,
          optionValueIds: ['value-blue'],
        },
      ],
      optionGroups: [
        {
          id: 'group-color',
          displayName: 'Color',
          values: [
            { id: 'value-red', displayName: 'Red' },
            { id: 'value-blue', displayName: 'Blue' },
            { id: 'value-green', displayName: 'Green' },
          ],
        },
        {
          id: 'group-size',
          displayName: 'Size',
          values: [{ id: 'value-large', displayName: 'Large' }],
        },
      ],
      variantOptionValuesByVariant: {
        'variant-red': [
          {
            id: 'value-red',
            optionGroupId: 'group-color',
            optionGroupName: 'Color',
            displayName: 'Red',
          },
        ],
      },
    });

    const assembly = await assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any);

    expect(assembly.snapshot.optionGroups).toEqual([
      {
        id: 'group-color',
        name: 'Color',
        values: [{ id: 'value-red', name: 'Red' }],
      },
    ]);
    expect(assembly.snapshot.variants).toEqual([
      expect.objectContaining({
        id: 'variant-red',
        optionCombination: [{ name: 'Color', value: 'Red' }],
      }),
    ]);
  });

  it('fails when more than one category is marked primary', async () => {
    const assembler = makeAssembler({
      categories: [
        { id: 'cat-1', isPrimary: true },
        { id: 'cat-2', isPrimary: true },
      ],
    });
    await expect(assembler.assembleActiveVersionSnapshot('master-1', 'version-1', {} as any)).rejects.toThrow(
      'Multiple primary categories',
    );
  });
});
```

- [ ] **Step 2: Run the assembler test and confirm RED**

Run:

```bash
yarn jest apps/core/src/modules/catalog/core/products/assemblers/projection-snapshot.assembler.spec.ts --runInBand
```

Expected: FAIL because `ProjectionSnapshotAssembler` does not exist.

- [ ] **Step 3: Add the assembler type and method**

Create `apps/core/src/modules/catalog/core/products/assemblers/projection-snapshot.assembler.ts`:

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { ProductSnapshot } from '@packages/event-contracts';
import { VariantPriceCacheService } from '../../pricing/variant-price-cache.service';
import { DbTransaction } from '../../../catalog.types';
import { OptionReadLoader } from '../loaders/option-read.loader';
import { ProductVersionReadLoader } from '../loaders/product-version-read.loader';
import { TagReadLoader } from '../loaders/tag-read.loader';

export type ProjectionSnapshotAssembly = {
  snapshot: ProductSnapshot;
  categoryIds: string[];
  primaryCategoryId: string | null;
};

type AssembleOptions = {
  locale?: string;
};

@Injectable()
export class ProjectionSnapshotAssembler {
  constructor(
    private readonly versionReadLoader: ProductVersionReadLoader,
    private readonly optionReadLoader: OptionReadLoader,
    private readonly tagReadLoader: TagReadLoader,
    private readonly priceCacheService: VariantPriceCacheService,
  ) {}

  async assembleActiveVersionSnapshot(
    masterId: string,
    versionId: string,
    tx: DbTransaction,
    options?: AssembleOptions,
  ): Promise<ProjectionSnapshotAssembly> {
    const locale = options?.locale ?? 'ko-KR';
    const version = await this.versionReadLoader.getVersionById(tx, versionId);
    if (version.masterId !== masterId) {
      throw new BadRequestException(`Version ${versionId} does not belong to master ${masterId}`);
    }
    if (version.status !== 'active') {
      throw new BadRequestException(`Cannot assemble projection snapshot for non-active version ${versionId}`);
    }

    const [categories, allVariants, images, tags, purchaseConstraint, cachedPrices, optionGroups] = await Promise.all([
      this.versionReadLoader.getCategories(tx, masterId, versionId),
      this.versionReadLoader.getVariants(tx, masterId, versionId),
      this.versionReadLoader.getImages(tx, versionId),
      this.tagReadLoader.getTags(tx, masterId, versionId),
      this.versionReadLoader.getPurchaseConstraint(tx, masterId, versionId),
      this.priceCacheService.getCachedPriceSetsByVersion(versionId, tx),
      this.optionReadLoader.getOptionGroups(tx, masterId, versionId, locale),
    ]);

    const primaryCategories = categories.filter((category) => category.isPrimary);
    if (primaryCategories.length > 1) {
      throw new BadRequestException(`Multiple primary categories for master ${masterId} version ${versionId}`);
    }

    const activeVariants = allVariants.filter((variant) => variant.status === 'active');
    if (activeVariants.length === 0) {
      throw new BadRequestException(`Projection snapshot requires at least one active variant: versionId=${versionId}`);
    }

    const priceMap = new Map(cachedPrices.map((price) => [price.variantId, price]));
    const optionGroupMap = new Map(optionGroups.map((group) => [group.id, group]));
    const usedOptionValueIds = new Set(activeVariants.flatMap((variant) => variant.optionValueIds));
    const usedOptionGroupIds = new Set<string>();
    const optionCombinationByVariant = new Map<string, Array<{ name: string; value: string }>>();

    for (const variant of activeVariants) {
      const displayRows = await this.optionReadLoader.getVariantOptionValues(tx, variant.id, versionId, locale);
      if (displayRows.length !== variant.optionValueIds.length) {
        throw new BadRequestException(`Missing option display for active variant ${variant.id} in version ${versionId}`);
      }

      const optionCombination = displayRows.map((row) => {
        if (!row.optionGroupName?.trim() || !row.displayName?.trim()) {
          throw new BadRequestException(`Missing option display for active variant ${variant.id} in version ${versionId}`);
        }
        usedOptionGroupIds.add(row.optionGroupId);
        return { name: row.optionGroupName, value: row.displayName };
      });
      optionCombinationByVariant.set(variant.id, optionCombination);
    }

    const snapshotOptionGroups = Array.from(usedOptionGroupIds).map((groupId) => {
      const group = optionGroupMap.get(groupId);
      if (!group || !group.displayName?.trim()) {
        throw new BadRequestException(`Missing option group display for active projection: groupId=${groupId}`);
      }
      return {
        id: group.id,
        name: group.displayName,
        values: group.values
          .filter((value) => usedOptionValueIds.has(value.id))
          .map((value) => {
            if (!value.displayName?.trim()) {
              throw new BadRequestException(`Missing option value display for active projection: valueId=${value.id}`);
            }
            return { id: value.id, name: value.displayName };
          }),
      };
    });

    const primaryImage = images.find((image) => image.isPrimary);
    const snapshot: ProductSnapshot = {
      masterId,
      versionId,
      version: version.version,
      name: version.name,
      description: version.description ?? undefined,
      descriptionHtml: version.descriptionHtml ?? undefined,
      thumbnail: primaryImage?.fileId,
      images: images.map((image) => ({
        fileId: image.fileId,
        url: image.fileId,
        isPrimary: image.isPrimary,
        sortOrder: image.sortOrder,
      })),
      seoTitle: version.seoTitle ?? undefined,
      seoDescription: version.seoDescription ?? undefined,
      seoKeywords: version.seoKeywords?.join(', ') || undefined,
      categories: categories.map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        path: category.path,
        parentId: category.parentId,
        isActive: category.isActive,
        visibility: category.visibility,
        showOnMainCategory: category.showOnMainCategory,
        thumbnail: category.thumbnailFileId ?? undefined,
      })),
      brand: version.brand ?? undefined,
      tags: tags.map((tag) => tag.name),
      productType: version.productType ?? undefined,
      fulfillmentKind: (version.fulfillmentKind ?? 'physical') as 'physical' | 'digital',
      optionGroups: snapshotOptionGroups,
      variants: activeVariants.map((variant) => {
        const price = priceMap.get(variant.id);
        if (!price) {
          throw new BadRequestException(`Missing calculated price cache for active variant ${variant.id} in version ${versionId}`);
        }
        if (!Number.isFinite(price.basePrice) || !Number.isFinite(price.membershipPrice)) {
          throw new Error(`Invalid calculated price cache for active variant ${variant.id} in version ${versionId}`);
        }
        return {
          id: variant.id,
          variantName: variant.variantName ?? '',
          sku: variant.id,
          variantCode: variant.variantCode ?? undefined,
          isDefault: variant.isDefault,
          status: 'active',
          optionCombination: optionCombinationByVariant.get(variant.id) ?? [],
          basePrice: price.basePrice,
          membershipPrice: price.membershipPrice,
          tieredPrices: price.tieredPrices ?? [],
        };
      }),
      status: 'active',
      isWholesaleOnly: version.isWholesaleOnly ?? false,
      hideMembershipPriceForNonMembers: version.hideMembershipPriceForNonMembers ?? version.isMembershipOnly ?? false,
      isMembershipOnly: version.hideMembershipPriceForNonMembers ?? version.isMembershipOnly ?? false,
      isVisibleToMembersOnly: version.isVisibleToMembersOnly ?? false,
      isGiftcard: false,
      discountable: true,
      purchaseConstraint: purchaseConstraint
        ? {
            requiresMembership: purchaseConstraint.requiresMembership,
            lifetimeQuantityLimit: purchaseConstraint.lifetimeQuantityLimit,
          }
        : undefined,
    };

    return {
      snapshot,
      categoryIds: categories.map((category) => category.id),
      primaryCategoryId: primaryCategories[0]?.id ?? null,
    };
  }
}
```

- [ ] **Step 4: Register the assembler**

Modify `apps/core/src/modules/catalog/core/products/products.module.ts`:

```ts
import { ProjectionSnapshotAssembler } from './assemblers/projection-snapshot.assembler';
```

Add `ProjectionSnapshotAssembler` to `providers`. Export it only if a consumer outside `ProductsModule` needs direct injection; `ProductVersionsService` is in the same module.

- [ ] **Step 5: Run assembler tests and type-check through product tests**

Run:

```bash
yarn jest apps/core/src/modules/catalog/core/products/assemblers/projection-snapshot.assembler.spec.ts --runInBand
yarn jest apps/core/src/modules/catalog/core/products/assemblers/product-read.assembler.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/assemblers/projection-snapshot.assembler.ts apps/core/src/modules/catalog/core/products/assemblers/projection-snapshot.assembler.spec.ts apps/core/src/modules/catalog/core/products/products.module.ts
git commit -m "[catalog] add active projection snapshot assembler"
```

---

### Task 5: Publish Workflow Uses Projection Snapshot Assembly

**Files:**
- Modify: `apps/core/src/modules/catalog/core/products/services/product-versions.service.ts`
- Modify: `apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts`

- [ ] **Step 1: Update service tests for explicit event assembly**

In each `makeService` helper that constructs `ProductVersionsService`, add the new constructor argument after `productReadAssembler`. For the outbox-event describe block, use this complete helper:

```ts
function makeService() {
  const productPublisher = {
    publishEvent: jest.fn().mockResolvedValue(undefined),
  };
  const outboxPublisher = {
    saveEvent: jest.fn().mockResolvedValue(undefined),
  };
  const pricingValidator = {
    validateCalculatedPrices: jest.fn().mockResolvedValue(undefined),
  };
  const productReadAssembler = {};
  const projectionSnapshotAssembler = {
    assembleActiveVersionSnapshot: jest.fn().mockResolvedValue({
      snapshot: {
        masterId: 'master-1',
        versionId: 'version-2',
        version: 2,
        name: 'Lip Tint',
        variants: [
          {
            id: 'variant-1',
            variantName: 'Red',
            sku: 'variant-1',
            isDefault: true,
            status: 'active',
            basePrice: 10000,
            membershipPrice: 9000,
            tieredPrices: [],
          },
        ],
        status: 'active',
        isWholesaleOnly: false,
        hideMembershipPriceForNonMembers: false,
        isVisibleToMembersOnly: false,
        isMembershipOnly: false,
        isGiftcard: false,
        discountable: true,
      },
      categoryIds: ['cat-1'],
      primaryCategoryId: 'cat-1',
    }),
  };
  const priceCacheService = {
    cachePricesForVersion: jest.fn().mockResolvedValue(1),
  };
  const variantAssetLinkService = {};
  const productSellableQuantity = {
    recalculateAndPublishForVariants: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ProductVersionsService(
    {} as any,
    productPublisher as any,
    outboxPublisher as any,
    pricingValidator as any,
    productReadAssembler as any,
    projectionSnapshotAssembler as any,
    priceCacheService as any,
    variantAssetLinkService as any,
    productSellableQuantity as any,
  );

  return {
    service,
    productPublisher,
    outboxPublisher,
    pricingValidator,
    projectionSnapshotAssembler,
    priceCacheService,
    productSellableQuantity,
  };
}
```

Append these tests after the helper in the outbox-event describe block:

```ts
it('uses caller-provided changeReason and projection assembly for active events', async () => {
  const { service, outboxPublisher, projectionSnapshotAssembler } = makeService();
  const tx = {} as any;

  await (service as any)._emitActiveVersionChangedEvent(
    { id: 'version-2', masterId: 'master-1', name: 'Lip Tint' },
    { id: 'version-1' },
    'rollback',
    tx,
  );

  expect(projectionSnapshotAssembler.assembleActiveVersionSnapshot).toHaveBeenCalledWith('master-1', 'version-2', tx);
  expect(outboxPublisher.saveEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: expect.objectContaining({
        versionId: 'version-2',
        previousActiveVersionId: 'version-1',
        categoryIds: ['cat-1'],
        primaryCategoryId: 'cat-1',
        changeReason: 'rollback',
        snapshot: expect.objectContaining({ versionId: 'version-2' }),
      }),
    }),
    tx,
  );
});

it('does not assemble a snapshot for unpublished events', async () => {
  const { service, outboxPublisher, projectionSnapshotAssembler } = makeService();
  const tx = {} as any;

  await (service as any)._emitActiveVersionChangedEvent(
    { id: 'version-2', masterId: 'master-1', name: 'Lip Tint' },
    { id: 'version-2' },
    'unpublished',
    tx,
  );

  expect(projectionSnapshotAssembler.assembleActiveVersionSnapshot).not.toHaveBeenCalled();
  expect(outboxPublisher.saveEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      payload: expect.objectContaining({
        versionId: null,
        name: null,
        categoryIds: [],
        primaryCategoryId: null,
        changeReason: 'unpublished',
        snapshot: null,
      }),
    }),
    tx,
  );
});
```

Append this publish ordering test in the same describe block:

```ts
it('validates and refreshes prices before activating, then assembles and enqueues the snapshot in the same transaction', async () => {
  const {
    service,
    outboxPublisher,
    pricingValidator,
    projectionSnapshotAssembler,
    priceCacheService,
    productSellableQuantity,
  } = makeService();
  const order: string[] = [];
  const draftVersion = {
    id: 'version-2',
    masterId: 'master-1',
    status: 'draft',
    name: 'Lip Tint',
    productCode: 'AY-LIP-001',
  };
  const previousActiveVersion = {
    id: 'version-1',
    masterId: 'master-1',
    status: 'active',
    name: 'Old Lip Tint',
  };
  const tx = {
    update: jest.fn(() => ({
      set: jest.fn((values: { status?: string }) => ({
        where: jest.fn(async () => {
          order.push(values.status === 'inactive' ? 'deactivatePrevious' : 'activateTarget');
        }),
      })),
    })),
  };

  jest.spyOn(service, 'getVersionById').mockResolvedValue(draftVersion as any);
  jest.spyOn(service, 'getActiveVersion').mockResolvedValue(previousActiveVersion as any);
  jest.spyOn(service as any, '_validateVariantCodeUniqueness').mockImplementation(async () => {
    order.push('validateVariantCode');
  });
  jest.spyOn(service, 'validateProductCodeUniqueness').mockImplementation(async () => {
    order.push('validateProductCode');
  });
  pricingValidator.validateCalculatedPrices.mockImplementation(async () => {
    order.push('validatePrices');
  });
  priceCacheService.cachePricesForVersion.mockImplementation(async () => {
    order.push('cachePrices');
    return 1;
  });
  jest.spyOn(service as any, '_reconcileMatchingsAfterPublish').mockImplementation(async () => {
    order.push('reconcileMatchings');
  });
  jest.spyOn(service as any, '_reconcileAssetLinksAfterPublish').mockImplementation(async () => {
    order.push('reconcileAssetLinks');
  });
  jest.spyOn(service as any, '_publishVariantChangeEvents').mockImplementation(async () => {
    order.push('publishVariantChanges');
  });
  projectionSnapshotAssembler.assembleActiveVersionSnapshot.mockImplementation(async () => {
    order.push('assembleSnapshot');
    return {
      snapshot: {
        masterId: 'master-1',
        versionId: 'version-2',
        version: 2,
        name: 'Lip Tint',
        variants: [
          {
            id: 'variant-1',
            variantName: 'Red',
            sku: 'variant-1',
            isDefault: true,
            status: 'active',
            basePrice: 10000,
          },
        ],
        status: 'active',
        isWholesaleOnly: false,
        hideMembershipPriceForNonMembers: false,
        isVisibleToMembersOnly: false,
        isMembershipOnly: false,
        isGiftcard: false,
        discountable: true,
      },
      categoryIds: ['cat-1'],
      primaryCategoryId: 'cat-1',
    };
  });
  outboxPublisher.saveEvent.mockImplementation(async () => {
    order.push('saveOutbox');
  });
  jest.spyOn(service, 'getVersionVariants').mockResolvedValue(['variant-1']);
  productSellableQuantity.recalculateAndPublishForVariants.mockImplementation(async () => {
    order.push('recalculateSellableQuantity');
  });

  await service.publishVersion('version-2', tx as any);

  expect(order).toEqual([
    'validateVariantCode',
    'validateProductCode',
    'validatePrices',
    'cachePrices',
    'deactivatePrevious',
    'activateTarget',
    'reconcileMatchings',
    'reconcileAssetLinks',
    'publishVariantChanges',
    'assembleSnapshot',
    'saveOutbox',
    'recalculateSellableQuantity',
  ]);
});
```

- [ ] **Step 2: Run service tests and confirm RED**

Run:

```bash
yarn jest apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts --runInBand
```

Expected: FAIL because `_emitActiveVersionChangedEvent` still infers reason and calls `_buildFullSnapshot`.

- [ ] **Step 3: Inject `ProjectionSnapshotAssembler`**

Modify imports:

```ts
import { ProjectionSnapshotAssembler } from '../assemblers/projection-snapshot.assembler';
```

Modify constructor:

```ts
constructor(
  @InjectDb() private readonly db: DbService<PimSchema>,
  @InjectStreamPublisher(PRODUCT_STREAM.topic.topic)
  private readonly productPublisher: StreamPublisher<ProductEvents>,
  private readonly outboxPublisher: OutboxPublisher,
  private readonly pricingValidator: PricingValidatorService,
  private readonly productReadAssembler: ProductReadAssembler,
  private readonly projectionSnapshotAssembler: ProjectionSnapshotAssembler,
  private readonly priceCacheService: VariantPriceCacheService,
  private readonly variantAssetLinkService: VariantAssetLinkService,
  private readonly productSellableQuantity: ProductSellableQuantityService,
) {}
```

For the other `new ProductVersionsService(...)` calls in `product-versions.service.spec.ts`, insert a projection assembler mock between the `ProductReadAssembler` argument and the `VariantPriceCacheService` argument. The final constructor argument order in tests must match this shape:

```ts
return new ProductVersionsService(
  {} as any,
  productPublisher as any,
  outboxPublisher as any,
  {} as any,
  {} as any,
  { assembleActiveVersionSnapshot: jest.fn() } as any,
  {} as any,
  {} as any,
  {} as any,
);
```

- [ ] **Step 4: Reorder `publishVersion` and pass explicit reason**

At the start of `publishVersion`, determine the reason from the target version's pre-publish status:

```ts
const changeReason = version.status === 'inactive' ? 'rollback' : 'published';
```

Keep variant/product code validation before price validation. Move price validation and cache refresh before any active-state update:

```ts
await this._validateVariantCodeUniqueness(versionId, tx);
await this.validateProductCodeUniqueness(version, tx);
await this.pricingValidator.validateCalculatedPrices(versionId, tx);
await this.priceCacheService.cachePricesForVersion(versionId, tx);
```

Then deactivate the previous active version and activate the target:

```ts
await tx
  .update(productMasterVersions)
  .set({ status: 'inactive' })
  .where(and(eq(productMasterVersions.masterId, version.masterId), eq(productMasterVersions.status, 'active')));

await tx
  .update(productMasterVersions)
  .set({ status: 'active', draftOwnerId: null, updatedAt: new Date() })
  .where(eq(productMasterVersions.id, versionId));
```

Emit the active event with explicit reason:

```ts
await this._emitActiveVersionChangedEvent(version, previousActiveVersion, changeReason, tx);
```

The assembler will reload the version from the same transaction and verify it is DB-visible active.

- [ ] **Step 5: Replace event builder internals**

Change the private method signature:

```ts
private async _emitActiveVersionChangedEvent(
  version: ProductMasterVersion,
  previousActiveVersion: ProductMasterVersion | null,
  changeReason: 'published' | 'unpublished' | 'rollback',
  tx: DbTransaction,
): Promise<void>
```

Use projection assembly only for active reasons:

```ts
const assembly =
  changeReason === 'unpublished'
    ? null
    : await this.projectionSnapshotAssembler.assembleActiveVersionSnapshot(version.masterId, version.id, tx);
const snapshot = assembly?.snapshot ?? null;
const categoryIds = assembly?.categoryIds ?? [];
const primaryCategoryId = assembly?.primaryCategoryId ?? null;

await this.outboxPublisher.saveEvent(
  {
    topic: PRODUCT_STREAM.topic.topic,
    eventType: 'ProductMasterActiveVersionChanged',
    aggregateType: PRODUCT_STREAM.aggregateType,
    aggregateId: version.masterId,
    payload: {
      masterId: version.masterId,
      versionId: changeReason === 'unpublished' ? null : version.id,
      name: changeReason === 'unpublished' ? null : snapshot?.name ?? version.name,
      previousActiveVersionId: previousActiveVersion?.id ?? null,
      categoryIds,
      primaryCategoryId,
      changeReason,
      changedAt: new Date().toISOString(),
      snapshot,
    },
  },
  tx,
);
```

Remove private snapshot helper methods that no longer have callers: `_buildFullSnapshot`, `_getVersionPurchaseConstraint`, `_buildCategoryTree`, `_buildCategoryPath`, `_getVersionOptionGroups`, `_getVersionVariants`, `getPrimaryCategoryId`, and `getVersionCategoryIds`. Clean up imports that were only used by those methods.

- [ ] **Step 6: Route active policy resync and unpublish through explicit reasons**

In `updateMembershipPriceVisibility` and `updateMembersOnlyVisibility`, call:

```ts
await this._emitActiveVersionChangedEvent(activeVersion, null, 'published', tx);
```

Do not pass the patched in-memory version as the snapshot source; the assembler reloads the just-updated active version inside the transaction.

In `unpublishMaster`, call:

```ts
await this._emitActiveVersionChangedEvent(activeVersion, activeVersion, 'unpublished', tx);
```

- [ ] **Step 7: Run service tests and confirm GREEN**

Run:

```bash
yarn jest apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/core/src/modules/catalog/core/products/services/product-versions.service.ts apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts
git commit -m "[catalog] publish active snapshots through projection assembler"
```

---

### Task 6: Channel Adapter File UUID Compatibility

**Files:**
- Modify: `apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.spec.ts`

- [ ] **Step 1: Add transformer tests for File UUID image fields**

Update the base `mockSnapshot.images` fixture from legacy strings to event-contract image objects:

```ts
images: [
  { fileId: 'img-001', url: 'img-001', isPrimary: true, sortOrder: 1 },
  { fileId: 'img-002', url: 'img-002', isPrimary: false, sortOrder: 2 },
],
```

Add a dedicated test:

```ts
it('accepts Core File UUIDs in thumbnail and image url compatibility fields', () => {
  const result = transformPimToMedusa({
    ...mockSnapshot,
    thumbnail: 'thumb-001',
    images: [
      { fileId: 'img-001', url: 'img-001', isPrimary: true, sortOrder: 2 },
      { fileId: 'img-000', url: 'img-000', isPrimary: false, sortOrder: 1 },
    ],
  });

  expect(result.thumbnail).toBe('thumb-001');
  expect(result.images).toEqual([{ url: 'img-001' }, { url: 'img-000' }]);
});
```

Keep the existing absolute URL preservation behavior covered by the current `toFileId` logic; this slice only proves new Core UUID-shaped payloads do not break Medusa projection.

- [ ] **Step 2: Run transformer tests and confirm GREEN**

Run:

```bash
yarn jest apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.spec.ts --runInBand
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.spec.ts
git commit -m "[channel-adapter] cover pim file uuid image projection"
```

---

### Task 7: Slice Verification

**Files:**
- Verify all files changed by Tasks 1-6.

- [ ] **Step 1: Run focused Jest suites**

Run:

```bash
yarn jest apps/core/src/modules/catalog/core/products/loaders/product-version-read.loader.spec.ts --runInBand
yarn jest apps/core/src/modules/catalog/core/products/assemblers/product-read.assembler.spec.ts --runInBand
yarn jest apps/core/src/modules/catalog/core/products/assemblers/projection-snapshot.assembler.spec.ts --runInBand
yarn jest apps/core/src/modules/catalog/core/pricing/variant-price-cache.service.spec.ts --runInBand
yarn jest apps/core/src/modules/catalog/core/products/services/product-versions.service.spec.ts --runInBand
yarn jest apps/channel-adapter/src/adapters/medusa/transformers/pim-to-medusa.transformer.spec.ts --runInBand
```

Expected: all focused suites PASS.

- [ ] **Step 2: Run the broader product/channel-adapter regression set**

Run:

```bash
yarn jest apps/core/src/modules/catalog/core/products --runInBand
yarn jest apps/channel-adapter/src/adapters/medusa --runInBand
```

Expected: PASS, or document any pre-existing unrelated failures with exact failing test names.

- [ ] **Step 3: Run build**

Run:

```bash
yarn build
```

Expected: PASS.

- [ ] **Step 4: Review code for agreed scope boundaries**

Check these invariants before handing off:

```text
ProductVersionReadLoader returns neutral DB facts only.
ProjectionSnapshotAssembler returns only { snapshot, categoryIds, primaryCategoryId }.
ProjectionSnapshotAssembler defaults locale to ko-KR and no caller passes locale in this slice.
ProductSnapshot.thumbnail is a File UUID.
ProductSnapshot.images[].url equals ProductSnapshot.images[].fileId.
Projection snapshot includes only active variants.
Missing active variant prices fail with BadRequestException.
Non-active versions fail snapshot assembly.
Publish calculates and refreshes prices before changing active state.
Outbox enqueue remains in the same transaction as active status change.
Approval and bulk active-transition paths are not changed in this slice.
```

- [ ] **Step 5: Final commit if previous task commits were squashed by execution flow**

```bash
git add apps/core/src/modules/catalog/core/products apps/core/src/modules/catalog/core/pricing apps/channel-adapter/src/adapters/medusa/transformers
git commit -m "[catalog] split active projection snapshot assembly"
```
