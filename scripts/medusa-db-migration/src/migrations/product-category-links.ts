import { and, eq, inArray, isNull } from 'drizzle-orm';
import { createPimDb } from '../lib/pim-db';
import { createMedusaDb } from '../lib/medusa-db';
import { isWriteEnabled } from '../lib/env';
import {
  productMasterCategories,
  productMasterVersions,
} from '../../drizzle/pim/schema';
import {
  product as medusaProduct,
  productCategory as medusaProductCategory,
  productCategoryProduct,
} from '../../drizzle/medusa/schema';

export interface ProductCategoryLinksMigrationOptions {
  dryRun: boolean;
  masterIds?: string[];
}

export async function migrateProductCategoryLinks(
  options: ProductCategoryLinksMigrationOptions,
): Promise<void> {
  if (!options.dryRun && !isWriteEnabled()) {
    throw new Error('Writes are disabled. Set ALLOW_DB_WRITES=true to proceed.');
  }

  const pimDb = createPimDb();
  const medusaDb = createMedusaDb();

  const filterMasterIds = (options.masterIds ?? []).filter(Boolean);
  const hasMasterFilter = filterMasterIds.length > 0;

  console.log(
    `[product-category-links] starting (dryRun=${options.dryRun}, masterFilter=${hasMasterFilter ? filterMasterIds.length : 'all'})`,
  );

  const activeVersions = await pimDb
    .select({
      masterId: productMasterVersions.masterId,
      versionId: productMasterVersions.id,
    })
    .from(productMasterVersions)
    .where(
      and(
        eq(productMasterVersions.status, 'active'),
        isNull(productMasterVersions.deletedAt),
        ...(hasMasterFilter
          ? [inArray(productMasterVersions.masterId, filterMasterIds)]
          : []),
      ),
    );

  if (activeVersions.length === 0) {
    console.log('[product-category-links] no active PIM versions found');
    return;
  }

  const activeVersionIdByMaster = new Map<string, string>();
  const masterIds = [] as string[];
  for (const row of activeVersions) {
    activeVersionIdByMaster.set(row.masterId, row.versionId);
    masterIds.push(row.masterId);
  }

  const pimCategoryRows = await pimDb
    .select({
      masterId: productMasterCategories.masterId,
      versionId: productMasterCategories.versionId,
      categoryId: productMasterCategories.categoryId,
    })
    .from(productMasterCategories)
    .where(inArray(productMasterCategories.masterId, masterIds));

  if (pimCategoryRows.length === 0) {
    console.log('[product-category-links] no PIM product categories found for target masters');
    return;
  }

  const pimCategoryIds = Array.from(new Set(pimCategoryRows.map((row) => row.categoryId)));

  const medusaCategoryRows = await medusaDb
    .select({
      id: medusaProductCategory.id,
      metadata: medusaProductCategory.metadata,
    })
    .from(medusaProductCategory)
    .where(isNull(medusaProductCategory.deletedAt));

  const medusaCategoryIdByPimId = new Map<string, string>();
  for (const row of medusaCategoryRows) {
    const pimCategoryId = getMetadataString(row.metadata, 'pimCategoryId');
    if (!pimCategoryId) continue;
    if (pimCategoryIds.includes(pimCategoryId) && !medusaCategoryIdByPimId.has(pimCategoryId)) {
      medusaCategoryIdByPimId.set(pimCategoryId, row.id);
    }
  }

  const medusaProductRows = await medusaDb
    .select({
      id: medusaProduct.id,
      externalId: medusaProduct.externalId,
    })
    .from(medusaProduct)
    .where(
      and(
        isNull(medusaProduct.deletedAt),
        inArray(medusaProduct.externalId, masterIds),
      ),
    );

  const medusaProductIdByMaster = new Map<string, string>();
  for (const row of medusaProductRows) {
    if (!row.externalId) continue;
    if (!medusaProductIdByMaster.has(row.externalId)) {
      medusaProductIdByMaster.set(row.externalId, row.id);
    }
  }

  let processedMasters = 0;
  let insertedLinks = 0;
  let warnings = 0;

  const rowsByMaster = new Map<string, string[]>();
  for (const row of pimCategoryRows) {
    const activeVersionId = activeVersionIdByMaster.get(row.masterId);
    if (!activeVersionId || activeVersionId !== row.versionId) continue;
    const list = rowsByMaster.get(row.masterId) ?? [];
    list.push(row.categoryId);
    rowsByMaster.set(row.masterId, list);
  }

  for (const [masterId, categoryIds] of rowsByMaster.entries()) {
    const medusaProductId = medusaProductIdByMaster.get(masterId);
    if (!medusaProductId) {
      warnings += 1;
      console.warn(
        `[product-category-links] skip master=${masterId} (no medusa product by external_id)`,
      );
      continue;
    }

    const uniqueCategoryIds = Array.from(new Set(categoryIds));
    for (const pimCategoryId of uniqueCategoryIds) {
      const medusaCategoryId = medusaCategoryIdByPimId.get(pimCategoryId);
      if (!medusaCategoryId) {
        warnings += 1;
        console.warn(
          `[product-category-links] skip master=${masterId} pimCategory=${pimCategoryId} (no medusa category metadata.pimCategoryId)`,
        );
        continue;
      }

      if (!options.dryRun) {
        await medusaDb
          .insert(productCategoryProduct)
          .values({
            productId: medusaProductId,
            productCategoryId: medusaCategoryId,
          })
          .onConflictDoNothing();
      }
      insertedLinks += 1;
    }

    processedMasters += 1;
  }

  console.log(
    `[product-category-links] done. processedMasters=${processedMasters}, insertedLinks=${insertedLinks}, warnings=${warnings}`,
  );
}

function getMetadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

