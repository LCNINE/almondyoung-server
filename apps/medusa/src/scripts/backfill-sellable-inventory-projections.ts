/**
 * PIM-synced Medusa variants 의 Product Sellable Quantity projection inventory link 보강.
 *
 * 기존 동기화가 `manage_inventory=false` 만 설정하고 inventory link 를 만들지 않았거나,
 * SKU 기반 inventory item 을 연결한 경우를 Medusa-local projection inventory item 으로 정리한다.
 *
 * 실행:
 *   yarn --cwd apps/medusa backfill:sellable-inventory
 */
import type { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { ensureSellableInventoryProjectionLinks } from './lib/sellable-inventory-projection';

export default async function backfillSellableInventoryProjections({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const batchSize = Number(process.env.SELLABLE_INVENTORY_BACKFILL_BATCH_SIZE || 100);
  const limit = process.env.SELLABLE_INVENTORY_BACKFILL_LIMIT
    ? Number(process.env.SELLABLE_INVENTORY_BACKFILL_LIMIT)
    : undefined;

  let skip = 0;
  let scanned = 0;
  let variantsSeen = 0;
  let linksCreated = 0;
  let linksRemoved = 0;

  while (limit === undefined || scanned < limit) {
    const take = limit === undefined ? batchSize : Math.min(batchSize, limit - scanned);
    if (take <= 0) break;

    const { data } = await query.graph({
      entity: 'product',
      fields: ['id', 'handle', 'metadata'],
      pagination: {
        take,
        skip,
        order: { created_at: 'ASC' },
      },
    });

    if (!data?.length) break;
    const pimSyncedProductIds = data
      .filter((product: any) => typeof product.metadata?.pimMasterId === 'string')
      .map((product: any) => product.id);

    if (pimSyncedProductIds.length > 0) {
      const ensured = await ensureSellableInventoryProjectionLinks(container, {
        productIds: pimSyncedProductIds,
        logger,
      });
      variantsSeen += ensured.variantsSeen;
      linksCreated += ensured.linksCreated;
      linksRemoved += ensured.linksRemoved;
    }

    scanned += data.length;
    skip += data.length;
    logger.info(
      `[sellable-inventory-backfill] scanned=${scanned}, pimProducts=${pimSyncedProductIds.length}, ` +
        `variants=${variantsSeen}, linksCreated=${linksCreated}, staleLinksRemoved=${linksRemoved}`,
    );

    if (data.length < take) break;
  }

  logger.info(
    `[sellable-inventory-backfill] Done. scanned=${scanned}, variants=${variantsSeen}, ` +
      `linksCreated=${linksCreated}, staleLinksRemoved=${linksRemoved}`,
  );
}
