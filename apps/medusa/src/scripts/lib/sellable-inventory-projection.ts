import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createInventoryItemsWorkflow, createLinksWorkflow } from '@medusajs/medusa/core-flows';
import {
  isMedusaProductSellableInventoryItem,
  toMedusaProductSellableInventorySku,
} from '../../utils/medusa-inventory-projection';

type Logger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

type EnsureInput = {
  productIds?: string[];
  productHandles?: string[];
  logger?: Logger;
};

type ProductVariantWithInventoryLinks = {
  id: string;
  title?: string;
  sku?: string | null;
  metadata?: Record<string, unknown> | null;
  inventory_items?: Array<{
    inventory_item_id?: string;
    inventory?: {
      sku?: string | null;
      metadata?: Record<string, unknown> | null;
    };
  }>;
};

type ProductWithVariants = {
  id: string;
  handle?: string | null;
  metadata?: Record<string, unknown> | null;
  variants?: ProductVariantWithInventoryLinks[];
};

async function getOrCreateProjectionInventoryItem(
  container: any,
  pimVariantId: string,
  title: string,
): Promise<string> {
  const inventoryService = container.resolve(Modules.INVENTORY);
  const sku = toMedusaProductSellableInventorySku(pimVariantId);
  const existing = await inventoryService.listInventoryItems({ sku }, { take: 1 });
  if (existing?.[0]?.id) {
    return existing[0].id;
  }

  try {
    const { result } = await createInventoryItemsWorkflow(container).run({
      input: {
        items: [
          {
            sku,
            title,
            requires_shipping: true,
            metadata: {
              projectionType: 'product_sellable_quantity',
              projectionSource: 'core',
              pimVariantId,
            },
          },
        ],
      },
    });
    if (!result?.[0]?.id) {
      throw new Error('createInventoryItemsWorkflow returned no inventory item id');
    }
    return result[0].id;
  } catch (error: any) {
    const isConflict = /already exists|duplicate/i.test(error?.message || '');
    if (!isConflict) throw error;

    const retried = await inventoryService.listInventoryItems({ sku }, { take: 1 });
    if (!retried?.[0]?.id) throw error;
    return retried[0].id;
  }
}

export async function ensureSellableInventoryProjectionLinks(container: any, input: EnsureInput) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const logger = input.logger;

  const filters: Record<string, string[]> = {};
  if (input.productIds?.length) {
    filters.id = Array.from(new Set(input.productIds));
  } else if (input.productHandles?.length) {
    filters.handle = Array.from(new Set(input.productHandles));
  } else {
    return { products: [], variantsSeen: 0, linksCreated: 0, linksRemoved: 0 };
  }

  const { data } = await query.graph({
    entity: 'product',
    fields: [
      'id',
      'handle',
      'metadata',
      'variants.id',
      'variants.title',
      'variants.sku',
      'variants.metadata',
      'variants.inventory_items.inventory_item_id',
      'variants.inventory_items.inventory.sku',
      'variants.inventory_items.inventory.metadata',
    ],
    filters,
  });
  const products = (data || []) as ProductWithVariants[];

  const linksToCreate: any[] = [];
  const linksToDismiss: any[] = [];
  let variantsSeen = 0;

  for (const product of products) {
    // 디지털 상품은 배송이 없으므로 sellable projection inventory(requires_shipping=true)를 만들지 않는다.
    // 런타임 동기화 경로(medusa.client ensureVariantInventoryLinks)와 동일하게 기존 projection 링크는 제거한다.
    const isDigital =
      product.metadata?.fulfillmentKind === 'digital' || product.metadata?.requiresShipping === false;

    if (isDigital) {
      for (const variant of product.variants || []) {
        const pimVariantId = variant.metadata?.pimVariantId;
        if (typeof pimVariantId !== 'string' || !pimVariantId) continue;
        variantsSeen += 1;

        const projectionSku = toMedusaProductSellableInventorySku(pimVariantId);
        for (const link of variant.inventory_items || []) {
          const isProjection =
            !!link.inventory_item_id &&
            (link.inventory?.sku === projectionSku ||
              (link.inventory?.metadata?.pimVariantId === pimVariantId &&
                isMedusaProductSellableInventoryItem(link.inventory)));
          if (isProjection) {
            linksToDismiss.push({
              [Modules.PRODUCT]: { variant_id: variant.id },
              [Modules.INVENTORY]: { inventory_item_id: link.inventory_item_id as string },
            });
          }
        }
      }
      continue;
    }

    for (const variant of product.variants || []) {
      const pimVariantId = variant.metadata?.pimVariantId;
      if (typeof pimVariantId !== 'string' || !pimVariantId) continue;
      variantsSeen += 1;

      const projectionSku = toMedusaProductSellableInventorySku(pimVariantId);
      const inventoryLinks = variant.inventory_items || [];
      const projectionLink = inventoryLinks.find(
        (inventoryLink) =>
          inventoryLink.inventory_item_id &&
          (inventoryLink.inventory?.sku === projectionSku ||
            (inventoryLink.inventory?.metadata?.pimVariantId === pimVariantId &&
              isMedusaProductSellableInventoryItem(inventoryLink.inventory))),
      );
      const inventoryItemId =
        projectionLink?.inventory_item_id ??
        (await getOrCreateProjectionInventoryItem(container, pimVariantId, variant.title || projectionSku));

      if (!projectionLink) {
        linksToCreate.push({
          [Modules.PRODUCT]: { variant_id: variant.id },
          [Modules.INVENTORY]: { inventory_item_id: inventoryItemId },
          data: { required_quantity: 1 },
        });
      }

      for (const staleLink of inventoryLinks) {
        if (!staleLink.inventory_item_id || staleLink.inventory_item_id === inventoryItemId) continue;
        linksToDismiss.push({
          [Modules.PRODUCT]: { variant_id: variant.id },
          [Modules.INVENTORY]: { inventory_item_id: staleLink.inventory_item_id },
        });
      }
    }
  }

  if (linksToCreate.length > 0) {
    await createLinksWorkflow(container).run({ input: linksToCreate });
  }

  if (linksToDismiss.length > 0) {
    await link.dismiss(linksToDismiss);
  }

  logger?.info?.(
    `[sellable-inventory] products=${products.length}, variants=${variantsSeen}, ` +
      `linksCreated=${linksToCreate.length}, staleLinksRemoved=${linksToDismiss.length}`,
  );
  if (input.productHandles?.length && products.length !== new Set(input.productHandles).size) {
    logger?.warn?.(
      `[sellable-inventory] Found ${products.length}/${new Set(input.productHandles).size} requested product handles`,
    );
  }

  return {
    products,
    variantsSeen,
    linksCreated: linksToCreate.length,
    linksRemoved: linksToDismiss.length,
  };
}
