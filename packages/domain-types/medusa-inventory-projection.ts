const MEDUSA_PRODUCT_SELLABLE_INVENTORY_SKU_PREFIX = 'psq_';

const NON_STOCK_GATED_REASONS = new Set([
  'MATCHING_MISSING',
  'MATCHING_PENDING',
  'MATCHING_IGNORED',
  'MATCHING_STRATEGY_UNSUPPORTED',
  'MATCHING_LINK_MISSING',
  'PRE_STOCK_SELLABLE',
  'ALWAYS_SELLABLE_ZERO_STOCK',
]);

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

export function shouldManageMedusaInventoryForSellableProjection(input: {
  reason?: string | null;
  isSellable?: boolean;
}): boolean {
  return !NON_STOCK_GATED_REASONS.has(input.reason ?? '');
}
