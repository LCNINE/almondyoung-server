const MEDUSA_PRODUCT_SELLABLE_INVENTORY_SKU_PREFIX = 'psq_';

export function toMedusaProductSellableInventorySku(pimVariantId: string): string {
  return `${MEDUSA_PRODUCT_SELLABLE_INVENTORY_SKU_PREFIX}${pimVariantId}`;
}

export function isMedusaProductSellableInventorySku(sku?: string | null): boolean {
  return Boolean(sku?.startsWith(MEDUSA_PRODUCT_SELLABLE_INVENTORY_SKU_PREFIX));
}

export function isMedusaProductSellableInventoryItem(input?: {
  sku?: string | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  if (!input) return false;

  const metadata = input.metadata ?? {};
  return (
    metadata.projectionType === 'product_sellable_quantity' ||
    metadata.projectionSource === 'core' ||
    isMedusaProductSellableInventorySku(input.sku)
  );
}
