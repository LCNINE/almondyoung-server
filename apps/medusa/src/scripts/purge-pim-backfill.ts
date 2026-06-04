/**
 * Hard purge PIM-synced catalog data created by the in-process backfill.
 *
 * This intentionally bypasses Medusa's soft-delete APIs. Use only before the
 * storefront is public or when you have confirmed there are no orders/carts
 * that should retain product references.
 *
 * Usage:
 *   yarn purge:pim-backfill
 *   PURGE_DRY_RUN=false PURGE_CONFIRM=purge-pim-backfill yarn purge:pim-backfill
 */
import { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { Client } from 'pg';

const CONFIRM_VALUE = 'purge-pim-backfill';
const CHUNK_SIZE = 1000;

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function isDryRun(): boolean {
  return process.env.PURGE_DRY_RUN !== 'false';
}

function shouldPurgeCategories(): boolean {
  return process.env.PURGE_CATEGORIES !== 'false';
}

function shouldPurgeOrphanTags(): boolean {
  return process.env.PURGE_ORPHAN_TAGS !== 'false';
}

function shouldPurgeWorkflowHistory(): boolean {
  return process.env.PURGE_WORKFLOW_HISTORY === 'true';
}

function requireConfirmation(dryRun: boolean): void {
  if (!dryRun && process.env.PURGE_CONFIRM !== CONFIRM_VALUE) {
    throw new Error(`Set PURGE_CONFIRM=${CONFIRM_VALUE} and PURGE_DRY_RUN=false to hard-delete rows.`);
  }
}

function createPgClient(): Client {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error('[purge-pim-backfill] DATABASE_URL is required.');
  }
  return new Client({ connectionString: databaseUrl });
}

async function pluckIds(client: Client, sql: string, params: unknown[] = []): Promise<string[]> {
  const result = await client.query<{ id: string }>(sql, params);
  return unique(result.rows.map((row) => row.id));
}

async function deleteWhereIn(client: Client, table: string, column: string, ids: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const result = await client.query(`DELETE FROM "${table}" WHERE "${column}" = ANY($1::text[])`, [chunk]);
    deleted += result.rowCount ?? 0;
  }
  return deleted;
}

async function deleteOptionalWhereIn(client: Client, table: string, column: string, ids: string[]): Promise<number> {
  try {
    return await deleteWhereIn(client, table, column, ids);
  } catch (error: any) {
    if (error?.code === '42P01') {
      return 0;
    }
    throw error;
  }
}

async function count(client: Client, sql: string, params: unknown[] = []): Promise<number> {
  const result = await client.query<{ count: string }>(sql, params);
  return Number(result.rows[0]?.count ?? 0);
}

export default async function purgePimBackfill({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger;
  const client = createPgClient();

  const dryRun = isDryRun();
  const purgeCategories = shouldPurgeCategories();
  const purgeOrphanTags = shouldPurgeOrphanTags();
  const purgeWorkflowHistory = shouldPurgeWorkflowHistory();

  requireConfirmation(dryRun);

  logger.warn(
    `[purge-pim-backfill] ${dryRun ? 'DRY RUN' : 'HARD DELETE'} ` +
      `(categories=${purgeCategories}, orphanTags=${purgeOrphanTags}, workflowHistory=${purgeWorkflowHistory})`,
  );

  await client.connect();
  try {
    const productIds = await pluckIds(client, `SELECT id FROM product WHERE metadata->>'pimMasterId' IS NOT NULL`);
    const variantIds = await pluckIds(client, `SELECT id FROM product_variant WHERE product_id = ANY($1::text[])`, [
      productIds,
    ]);
    const priceSetIds = await pluckIds(
      client,
      `SELECT price_set_id AS id FROM product_variant_price_set WHERE variant_id = ANY($1::text[])`,
      [variantIds],
    );
    const linkedInventoryItemIds = await pluckIds(
      client,
      `SELECT inventory_item_id AS id FROM product_variant_inventory_item WHERE variant_id = ANY($1::text[])`,
      [variantIds],
    );
    const projectionInventoryItemIds = await pluckIds(
      client,
      `SELECT id FROM inventory_item
       WHERE metadata->>'projectionType' = 'product_sellable_quantity'
          OR metadata->>'projectionSource' = 'core'`,
    );
    const inventoryItemIds = unique([...linkedInventoryItemIds, ...projectionInventoryItemIds]);

    const categoryCount = purgeCategories
      ? await count(client, `SELECT count(*) FROM product_category WHERE metadata->>'pimCategoryId' IS NOT NULL`)
      : 0;
    const orphanTagCount = purgeOrphanTags
      ? await count(
          client,
          `SELECT count(*)
           FROM product_tag pt
           WHERE NOT EXISTS (SELECT 1 FROM product_tags WHERE product_tag_id = pt.id)`,
        )
      : 0;
    const workflowHistoryCount = purgeWorkflowHistory
      ? await count(
          client,
          `SELECT count(*)
           FROM workflow_execution
           WHERE execution::text LIKE '%pimMasterId%' OR workflow_id ILIKE '%product%'`,
        )
      : 0;

    logger.info(`[purge-pim-backfill] Target products: ${productIds.length}`);
    logger.info(`[purge-pim-backfill] Target variants: ${variantIds.length}`);
    logger.info(`[purge-pim-backfill] Target price sets: ${priceSetIds.length}`);
    logger.info(`[purge-pim-backfill] Target inventory items: ${inventoryItemIds.length}`);
    logger.info(`[purge-pim-backfill] Target PIM categories: ${categoryCount}`);
    logger.info(`[purge-pim-backfill] Target orphan tags: ${orphanTagCount}`);
    logger.info(`[purge-pim-backfill] Target workflow history rows: ${workflowHistoryCount}`);

    if (dryRun) {
      logger.info('[purge-pim-backfill] Dry-run complete. No rows deleted.');
      return;
    }

    await client.query('BEGIN');
    try {
      const deleted: Record<string, number> = {};

      deleted.product_variant_inventory_item = await deleteWhereIn(
        client,
        'product_variant_inventory_item',
        'variant_id',
        variantIds,
      );
      deleted.product_variant_inventory_item += await deleteWhereIn(
        client,
        'product_variant_inventory_item',
        'inventory_item_id',
        inventoryItemIds,
      );
      deleted.inventory_level = await deleteWhereIn(client, 'inventory_level', 'inventory_item_id', inventoryItemIds);
      deleted.reservation_item = await deleteWhereIn(client, 'reservation_item', 'inventory_item_id', inventoryItemIds);
      deleted.inventory_item = await deleteWhereIn(client, 'inventory_item', 'id', inventoryItemIds);

      deleted.product_variant_price_set = await deleteWhereIn(
        client,
        'product_variant_price_set',
        'variant_id',
        variantIds,
      );
      deleted.product_variant_price_set += await deleteWhereIn(
        client,
        'product_variant_price_set',
        'price_set_id',
        priceSetIds,
      );
      deleted.price_set = await deleteWhereIn(client, 'price_set', 'id', priceSetIds);

      deleted.product_sales_channel = await deleteWhereIn(client, 'product_sales_channel', 'product_id', productIds);
      deleted.product_shipping_profile = await deleteWhereIn(
        client,
        'product_shipping_profile',
        'product_id',
        productIds,
      );
      deleted.product_sort_index = await deleteOptionalWhereIn(client, 'product_sort_index', 'product_id', productIds);

      deleted.product = await deleteWhereIn(client, 'product', 'id', productIds);

      if (purgeCategories) {
        const result = await client.query(`DELETE FROM product_category WHERE metadata->>'pimCategoryId' IS NOT NULL`);
        deleted.product_category = result.rowCount ?? 0;
      }

      if (purgeOrphanTags) {
        const result = await client.query(
          `DELETE FROM product_tag pt
           WHERE NOT EXISTS (SELECT 1 FROM product_tags WHERE product_tag_id = pt.id)`,
        );
        deleted.product_tag = result.rowCount ?? 0;
      }

      if (purgeWorkflowHistory) {
        const result = await client.query(
          `DELETE FROM workflow_execution
           WHERE execution::text LIKE '%pimMasterId%' OR workflow_id ILIKE '%product%'`,
        );
        deleted.workflow_execution = result.rowCount ?? 0;
      }

      await client.query('COMMIT');

      for (const [table, deletedCount] of Object.entries(deleted)) {
        logger.info(`[purge-pim-backfill] Deleted ${deletedCount} row(s) from ${table}`);
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const remainingProducts = await count(
      client,
      `SELECT count(*) FROM product WHERE metadata->>'pimMasterId' IS NOT NULL`,
    );
    const remainingCategories = await count(
      client,
      `SELECT count(*) FROM product_category WHERE metadata->>'pimCategoryId' IS NOT NULL`,
    );

    logger.info(
      `[purge-pim-backfill] Done. Remaining PIM products=${remainingProducts}, PIM categories=${remainingCategories}`,
    );
  } finally {
    await client.end();
  }
}
