import { sql, isNull, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import { createMedusaDb } from '../lib/medusa-db';
import { createPimDb } from '../lib/pim-db';
import { isWriteEnabled } from '../lib/env';
import { productCategories as pimProductCategories } from '../../drizzle/pim/schema';
import { productCategory as medusaProductCategory } from '../../drizzle/medusa/schema';

export interface CategoryMigrationOptions {
  dryRun: boolean;
}

export async function migrateCategories(options: CategoryMigrationOptions): Promise<void> {
  const medusaDb = createMedusaDb();
  const pimDb = createPimDb();

  if (!options.dryRun && !isWriteEnabled()) {
    throw new Error('Writes are disabled. Set ALLOW_DB_WRITES=true to proceed.');
  }

  console.log(`[categories] starting (dryRun=${options.dryRun})`);

  const pimRows = await pimDb
    .select()
    .from(pimProductCategories)
    .orderBy(pimProductCategories.level, pimProductCategories.sortOrder);

  if (pimRows.length === 0) {
    console.log('[categories] no PIM categories found');
    return;
  }

  const sorted = sortByParentFirst(pimRows);

  const existingRows = await medusaDb
    .select({
      id: medusaProductCategory.id,
      handle: medusaProductCategory.handle,
      parentCategoryId: medusaProductCategory.parentCategoryId,
      mpath: medusaProductCategory.mpath,
      metadata: medusaProductCategory.metadata,
    })
    .from(medusaProductCategory)
    .where(
      sql`(metadata->>'pimCategoryId') is not null and ${medusaProductCategory.deletedAt} is null`,
    );

  const existingByPimId = new Map<string, typeof existingRows[number]>();
  for (const row of existingRows) {
    const pimCategoryId = getPimCategoryId(row.metadata);
    if (pimCategoryId) {
      existingByPimId.set(pimCategoryId, row);
    }
  }

  const handleRows = await medusaDb
    .select({
      id: medusaProductCategory.id,
      handle: medusaProductCategory.handle,
      metadata: medusaProductCategory.metadata,
    })
    .from(medusaProductCategory)
    .where(isNull(medusaProductCategory.deletedAt));

  const handleIndex = new Map<
    string,
    { id: string; pimCategoryId?: string | null }
  >();
  for (const row of handleRows) {
    handleIndex.set(row.handle, {
      id: row.id,
      pimCategoryId: getPimCategoryId(row.metadata),
    });
  }

  const pimToMedusa = new Map<
    string,
    { id: string; mpath: string }
  >();

  let created = 0;
  let updated = 0;
  let warned = 0;

  for (const pimCategory of sorted) {
    const pimId = pimCategory.id;
    const desiredHandle = pimCategory.slug;

    let existing = existingByPimId.get(pimId) ?? null;
    if (!existing) {
      const fallback = await medusaDb
        .select({
          id: medusaProductCategory.id,
          handle: medusaProductCategory.handle,
          parentCategoryId: medusaProductCategory.parentCategoryId,
          mpath: medusaProductCategory.mpath,
          metadata: medusaProductCategory.metadata,
        })
        .from(medusaProductCategory)
        .where(eq(medusaProductCategory.handle, pimId))
        .limit(1);
      existing = fallback[0] ?? null;
    }

    const parentInfo = pimCategory.parentId
      ? pimToMedusa.get(pimCategory.parentId)
      : null;
    if (pimCategory.parentId && !parentInfo) {
      warned += 1;
      console.warn(
        `[categories] parent missing for ${pimId} (${pimCategory.parentId}); creating as root`,
      );
    }

    const medusaId = existing?.id ?? generateCategoryId();
    const parentCategoryId = parentInfo?.id ?? null;
    const mpath = parentInfo?.mpath
      ? `${parentInfo.mpath}.${medusaId}`
      : medusaId;

    const resolvedHandle = ensureUniqueHandle(
      desiredHandle,
      pimId,
      existing?.id,
      handleIndex,
    );
    if (resolvedHandle !== desiredHandle) {
      warned += 1;
      console.warn(
        `[categories] handle conflict for ${desiredHandle}; using ${resolvedHandle} (${pimId})`,
      );
    }

    const nextMetadata = buildMetadata(pimCategory, existing?.metadata);

    const payload = {
      id: medusaId,
      name: pimCategory.name,
      description: pimCategory.description ?? '',
      handle: resolvedHandle,
      mpath,
      isActive: Boolean(pimCategory.isActive && pimCategory.visibility),
      isInternal: false,
      rank: pimCategory.sortOrder ?? 0,
      parentCategoryId,
      metadata: nextMetadata,
      updatedAt: new Date(),
    };

    if (existing) {
      if (!options.dryRun) {
        await medusaDb
          .update(medusaProductCategory)
          .set(payload)
          .where(eq(medusaProductCategory.id, existing.id));
      }
      updated += 1;
      refreshHandleIndex(handleIndex, existing.handle, resolvedHandle, existing.id, pimId);
    } else {
      if (!options.dryRun) {
        await medusaDb
          .insert(medusaProductCategory)
          .values(payload);
      }
      created += 1;
      handleIndex.set(resolvedHandle, { id: medusaId, pimCategoryId: pimId });
    }

    pimToMedusa.set(pimId, { id: medusaId, mpath });

    console.log(
      `[categories] done. created=${created}, updated=${updated}, warnings=${warned}`,
    );
  }
}

function generateCategoryId(): string {
  return `pcat_${ulid()}`;
}

function getPimCategoryId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as { pimCategoryId?: string }).pimCategoryId;
  return value ?? null;
}

function buildMetadata(
  category: typeof pimProductCategories.$inferSelect,
  existingMetadata?: unknown,
): Record<string, unknown> {
  const display = category.displaySettings as { showOnMainCategory?: boolean } | null;

  return {
    ...(existingMetadata && typeof existingMetadata === 'object'
      ? (existingMetadata as Record<string, unknown>)
      : {}),
    pimCategoryId: category.id,
    pimSlug: category.slug,
    pimPath: category.path,
    pimVisibility: category.visibility,
    pimShowOnMainCategory: Boolean(display?.showOnMainCategory),
  };
}

function ensureUniqueHandle(
  desired: string,
  pimId: string,
  existingId: string | undefined,
  handleIndex: Map<string, { id: string; pimCategoryId?: string | null }>,
): string {
  const base = desired;
  let candidate = base;
  let counter = 0;
  const shortId = pimId.replace(/-/g, '').slice(0, 8);

  while (true) {
    const entry = handleIndex.get(candidate);
    if (!entry || entry.id === existingId || entry.pimCategoryId === pimId) {
      return candidate;
    }
    counter += 1;
    const suffix = counter === 1 ? shortId : `${shortId}-${counter}`;
    candidate = `${base}-${suffix}`;
  }
}

function refreshHandleIndex(
  handleIndex: Map<string, { id: string; pimCategoryId?: string | null }>,
  previousHandle: string,
  nextHandle: string,
  id: string,
  pimId: string,
): void {
  const prev = handleIndex.get(previousHandle);
  if (prev && prev.id === id) {
    handleIndex.delete(previousHandle);
  }
  handleIndex.set(nextHandle, { id, pimCategoryId: pimId });
}

function sortByParentFirst<T extends { id: string; parentId: string | null }>(
  categories: T[],
): T[] {
  const map = new Map<string, T>();
  categories.forEach((c) => map.set(c.id, c));

  const result: T[] = [];
  const visited = new Set<string>();

  function dfs(category: T) {
    if (visited.has(category.id)) return;
    if (category.parentId && map.has(category.parentId)) {
      dfs(map.get(category.parentId)!);
    }
    visited.add(category.id);
    result.push(category);
  }

  categories.forEach(dfs);
  return result;
}
