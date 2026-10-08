import type { MedusaContainer } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import type { SaleProductAction } from '../../../../packages/domain-types/time-sale';
import { listAllTimeSales } from './time-sale';
import {
  loadTimeSaleSettings,
  clearTimeSaleProductCache,
  revalidateTimeSaleCache,
  TIME_SALE_WRITE_LOCK,
  TIME_SALE_WRITE_LOCK_TTL,
} from './time-sale-settings';
import { randomUUID } from 'node:crypto';

export function productActionState(
  action: SaleProductAction | NonNullable<SaleProductAction['related']>[number],
  active: boolean,
) {
  if ('productId' in action) {
    return {
      display: active ? (action.displayOffStart ? false : undefined) : action.displayOnStop ? true : undefined,
      selling: active ? (action.sellingOffStart ? false : undefined) : action.sellingOnStop ? true : undefined,
    };
  }

  return {
    display: active ? (action.displayOnStart ? true : undefined) : action.displayOffStop ? false : undefined,
    selling: active ? (action.sellingOnStart ? true : undefined) : action.sellingOffStop ? false : undefined,
  };
}

// Existing minute job and admin saves share the sale write lock. No additional worker is needed.
export async function syncTimeSaleProductActions(container: MedusaContainer) {
  const locking = container.resolve(Modules.LOCKING);
  const ownerId = `time-sale-products:${randomUUID()}`;

  await locking.acquire(TIME_SALE_WRITE_LOCK, { ownerId, expire: TIME_SALE_WRITE_LOCK_TTL });

  try {
    const sales = await listAllTimeSales(container);
    const { settings } = await loadTimeSaleSettings(container, sales);
    const now = Date.now();
    const states = new Map<string, { display?: boolean; selling?: boolean }>();

    for (const sale of sales) {
      const display = settings.sales[sale.saleId];

      for (const [productId, action] of Object.entries(display?.productActions ?? {})) {
        if (!sale.productIds.includes(productId)) continue;

        const period = sale.products.find((product) => product.productId === productId);
        const start = Date.parse(period?.startsAt ?? sale.startsAt ?? '');
        const end = Date.parse(period?.endsAt ?? sale.endsAt ?? '');
        const active = settings.environment.enabled && sale.status === 'active' && now >= start && now < end;

        for (const item of [action, ...(action.related ?? [])]) {
          const targetId = 'productId' in item ? item.productId : productId;
          const next: { display?: boolean; selling?: boolean } = now < start ? {} : productActionState(item, active);
          const configured = Object.entries(item).some(
            ([key, value]) => /^(display|selling)/.test(key) && value === true,
          );

          if (!configured) continue;

          const previous = states.get(targetId) ?? {};

          // Concurrent controllers are combined conservatively: a stop always wins.
          states.set(targetId, {
            display: previous.display === false || next.display === false ? false : (next.display ?? previous.display),
            selling: previous.selling === false || next.selling === false ? false : (next.selling ?? previous.selling),
          });
        }
      }
    }

    const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
    const previouslyControlled = await knex.raw(
      "select id from product where deleted_at is null and metadata ? 'timeSaleControlled'",
    );
    const productIds = [
      ...new Set([...states.keys(), ...(previouslyControlled.rows ?? []).map((product: { id: string }) => product.id)]),
    ];
    const productModule = container.resolve(Modules.PRODUCT);
    const products = productIds.length
      ? await productModule.listProducts({ id: productIds }, { take: productIds.length, select: ['id', 'metadata'] })
      : [];
    const changed = new Set<string>();

    for (const product of products) {
      const metadata = { ...product.metadata };
      const state = states.get(product.id);
      const before = JSON.stringify(metadata);

      if (state) {
        metadata.timeSaleControlled = true;
        metadata.timeSaleDisplay = state.display ?? metadata.timeSaleDisplay ?? true;
        metadata.timeSaleSelling = state.selling ?? metadata.timeSaleSelling ?? true;
      } else {
        delete metadata.timeSaleControlled;
        delete metadata.timeSaleDisplay;
        delete metadata.timeSaleSelling;
      }

      if (JSON.stringify(metadata) !== before) {
        await productModule.updateProducts(product.id, { metadata });
        changed.add(product.id);
      }
    }

    if (changed.size) {
      await clearTimeSaleProductCache(container, [...changed]);
      await revalidateTimeSaleCache(container);
    }
  } finally {
    await locking.release(TIME_SALE_WRITE_LOCK, { ownerId });
  }
}
