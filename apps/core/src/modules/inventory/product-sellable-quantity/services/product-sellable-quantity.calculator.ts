export const UNBOUNDED_SELLABLE_QUANTITY = 99_999_999;

export type ProductSellableQuantityReason =
  | 'SELLABLE'
  | 'PRE_STOCK_SELLABLE'
  | 'ALWAYS_SELLABLE_ZERO_STOCK'
  | 'NOT_ACTIVE_VERSION'
  | 'VARIANT_INACTIVE'
  | 'SALES_NOT_STARTED'
  | 'SALES_ENDED'
  | 'MATCHING_MISSING'
  | 'MATCHING_PENDING'
  | 'MATCHING_IGNORED'
  | 'MATCHING_STRATEGY_UNSUPPORTED'
  | 'MATCHING_LINK_MISSING'
  | 'INSUFFICIENT_COMPONENT_STOCK';

export interface ProductSellableQuantityComponentInput {
  skuId: string;
  requiredQuantity: number;
  availableQuantity: number;
}

export interface ProductSellableQuantityInput {
  variantId: string;
  variantStatus: string | null;
  activeVersion: {
    masterId: string;
    versionId: string;
    salesStartDate?: Date | null;
    salesEndDate?: Date | null;
  } | null;
  matching: {
    id: string;
    status: 'pending' | 'matched' | 'ignored';
    strategy: 'void' | 'variant' | null;
    preStockSellable: boolean;
    alwaysSellableZeroStock: boolean;
  } | null;
  components: ProductSellableQuantityComponentInput[];
}

export interface ProductSellableQuantityComponentResult extends ProductSellableQuantityComponentInput {
  componentSellableQuantity: number;
}

export interface ProductSellableQuantityResult {
  variantId: string;
  masterId: string | null;
  versionId: string | null;
  matchingId: string | null;
  sellableQuantity: number;
  stockBoundQuantity: number;
  isSellable: boolean;
  reason: ProductSellableQuantityReason;
  preStockSellable: boolean;
  alwaysSellableZeroStock: boolean;
  components: ProductSellableQuantityComponentResult[];
  calculatedAt: Date;
}

export function calculateProductSellableQuantity(
  input: ProductSellableQuantityInput,
  options: { now?: Date; unboundedQuantity?: number } = {},
): ProductSellableQuantityResult {
  const calculatedAt = options.now ?? new Date();
  const unboundedQuantity = options.unboundedQuantity ?? UNBOUNDED_SELLABLE_QUANTITY;

  const base = {
    variantId: input.variantId,
    masterId: input.activeVersion?.masterId ?? null,
    versionId: input.activeVersion?.versionId ?? null,
    matchingId: input.matching?.id ?? null,
    preStockSellable: input.matching?.preStockSellable ?? false,
    alwaysSellableZeroStock: input.matching?.alwaysSellableZeroStock ?? false,
    calculatedAt,
  };

  const zero = (reason: ProductSellableQuantityReason, components = componentResults(input.components, 0)) => ({
    ...base,
    sellableQuantity: 0,
    stockBoundQuantity: 0,
    isSellable: false,
    reason,
    components,
  });

  if (!input.activeVersion) {
    return zero('NOT_ACTIVE_VERSION');
  }

  if (input.variantStatus !== 'active') {
    return zero('VARIANT_INACTIVE');
  }

  if (input.activeVersion.salesStartDate && input.activeVersion.salesStartDate > calculatedAt) {
    return zero('SALES_NOT_STARTED');
  }

  if (input.activeVersion.salesEndDate && input.activeVersion.salesEndDate < calculatedAt) {
    return zero('SALES_ENDED');
  }

  if (!input.matching) {
    return zero('MATCHING_MISSING');
  }

  if (input.matching.status === 'pending') {
    return zero('MATCHING_PENDING');
  }

  if (input.matching.status === 'ignored') {
    return zero('MATCHING_IGNORED');
  }

  if (input.matching.strategy !== 'variant') {
    return zero('MATCHING_STRATEGY_UNSUPPORTED');
  }

  if (input.components.length === 0) {
    return zero('MATCHING_LINK_MISSING');
  }

  const components = componentResults(input.components);
  const stockBoundQuantity = Math.min(...components.map((component) => component.componentSellableQuantity));

  if (stockBoundQuantity > 0) {
    return {
      ...base,
      sellableQuantity: stockBoundQuantity,
      stockBoundQuantity,
      isSellable: true,
      reason: 'SELLABLE',
      components,
    };
  }

  if (input.matching.alwaysSellableZeroStock) {
    return {
      ...base,
      sellableQuantity: unboundedQuantity,
      stockBoundQuantity,
      isSellable: true,
      reason: 'ALWAYS_SELLABLE_ZERO_STOCK',
      components,
    };
  }

  if (input.matching.preStockSellable) {
    return {
      ...base,
      sellableQuantity: unboundedQuantity,
      stockBoundQuantity,
      isSellable: true,
      reason: 'PRE_STOCK_SELLABLE',
      components,
    };
  }

  return {
    ...base,
    sellableQuantity: 0,
    stockBoundQuantity,
    isSellable: false,
    reason: 'INSUFFICIENT_COMPONENT_STOCK',
    components,
  };
}

function componentResults(
  components: ProductSellableQuantityComponentInput[],
  defaultComponentSellableQuantity?: number,
): ProductSellableQuantityComponentResult[] {
  return components.map((component) => {
    const requiredQuantity = Math.max(1, Math.trunc(component.requiredQuantity || 1));
    const availableQuantity = Math.max(0, Math.trunc(component.availableQuantity || 0));
    const componentSellableQuantity =
      defaultComponentSellableQuantity ?? Math.floor(availableQuantity / requiredQuantity);

    return {
      skuId: component.skuId,
      requiredQuantity,
      availableQuantity,
      componentSellableQuantity,
    };
  });
}
