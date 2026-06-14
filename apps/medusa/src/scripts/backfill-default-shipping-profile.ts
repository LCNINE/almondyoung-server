import type { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { updateProductsWorkflow } from '@medusajs/medusa/core-flows';
import { buildDefaultShippingProfileUpdates, type BackfillProduct } from './lib/default-shipping-profile-backfill';

const CONFIRM_VALUE = 'backfill-default-shipping-profile';

export default async function backfillDefaultShippingProfile({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);

  const batchSize = Number(process.env.SHIPPING_PROFILE_BACKFILL_BATCH_SIZE || 100);
  const limit = process.env.SHIPPING_PROFILE_BACKFILL_LIMIT
    ? Number(process.env.SHIPPING_PROFILE_BACKFILL_LIMIT)
    : undefined;
  const dryRun = process.env.SHIPPING_PROFILE_BACKFILL_DRY_RUN !== 'false';
  const confirm = process.env.SHIPPING_PROFILE_BACKFILL_CONFIRM;

  if (!dryRun && confirm !== CONFIRM_VALUE) {
    throw new Error(
      `Set SHIPPING_PROFILE_BACKFILL_CONFIRM=${CONFIRM_VALUE} when SHIPPING_PROFILE_BACKFILL_DRY_RUN=false`,
    );
  }

  const profiles = await fulfillmentModuleService.listShippingProfiles({ type: 'default' });
  const defaultProfile = profiles[0];
  if (!defaultProfile?.id) {
    throw new Error('Default shipping profile not found. Run yarn --cwd apps/medusa seed:shipping first.');
  }

  logger.info(
    `[shipping-profile-backfill] mode=${dryRun ? 'dry-run' : 'write'} profile=${defaultProfile.id} batchSize=${batchSize} limit=${limit ?? 'none'}`,
  );

  let skip = 0;
  let scanned = 0;
  let selected = 0;
  let updated = 0;

  while (limit === undefined || scanned < limit) {
    const take = limit === undefined ? batchSize : Math.min(batchSize, limit - scanned);
    if (take <= 0) break;

    const { data } = await query.graph({
      entity: 'product',
      fields: ['id', 'handle', 'metadata', 'is_giftcard', 'shipping_profile.id'],
      pagination: {
        take,
        skip,
        order: { created_at: 'ASC' },
      },
    });

    const products = (data || []) as BackfillProduct[];
    if (products.length === 0) break;

    const updates = buildDefaultShippingProfileUpdates(products, defaultProfile.id);
    selected += updates.length;

    if (!dryRun && updates.length > 0) {
      const { result } = await updateProductsWorkflow(container).run({
        input: {
          products: updates,
        },
      });
      updated += result.length;
    }

    scanned += products.length;
    skip += products.length;
    logger.info(`[shipping-profile-backfill] scanned=${scanned} selected=${selected} updated=${updated}`);

    if (products.length < take) break;
  }

  logger.info(
    `[shipping-profile-backfill] Done. scanned=${scanned} selected=${selected} updated=${updated} dryRun=${dryRun}`,
  );
}
