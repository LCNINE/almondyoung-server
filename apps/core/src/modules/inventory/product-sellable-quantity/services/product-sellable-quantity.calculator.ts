import { type ProductSellableQuantityReason } from '@packages/event-contracts';

export type { ProductSellableQuantityReason } from '@packages/event-contracts';

export const UNBOUNDED_SELLABLE_QUANTITY = 99_999_999;

export type ProductAvailabilityOverride = 'manual_out_of_stock' | 'coming_soon' | null;

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
  availabilityOverride?: ProductAvailabilityOverride;
  /** 표시 전용 출시예정일 (YYYY-MM-DD). 계산에는 쓰이지 않고 그대로 결과에 실려 나간다. */
  comingSoonDate?: string | null;
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
  availabilityOverride: ProductAvailabilityOverride;
  comingSoonDate: string | null;
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
    availabilityOverride: input.availabilityOverride ?? null,
    comingSoonDate: input.comingSoonDate ?? null,
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

  if (input.availabilityOverride === 'manual_out_of_stock') {
    return zero('MANUAL_OUT_OF_STOCK');
  }

  // 출시예정 = "아직 물건이 없다"는 선언. 재고 없이 파는 모든 경로(선판매·항상판매·void)를
  // 무시하고 실재고로만 판정한다 — 판매를 여는 건 날짜가 아니라 입고다 (ADR-0028).
  // 플래그는 재고가 들어오는 순간 자동 해제되므로 선판매 정책은 그때 그대로 복원된다.
  const comingSoon = input.availabilityOverride === 'coming_soon';

  // 실재고를 셀 수 있는 매칭은 matched + variant 뿐이다. 나머지(매칭없음/pending/ignored/void)는
  // 전부 non-stock-gated 사유로 빠져 Medusa 에서 manage_inventory=false, 즉 "재고 무시하고 판매"
  // 로 나간다. 그래서 출시예정은 매칭 상태보다 **앞서** 끊어야 한다 — 뒤에 두면 매칭이 안 걸린
  // 신상품이 "곧 출시 예정" 이라고 표시되면서 구매까지 되고, reason 도 안 바뀌어 변경 감지에
  // 걸리지 않아 Medusa 로 전파조차 되지 않는다.
  const stockCountableMatching =
    input.matching?.status === 'matched' && input.matching.strategy === 'variant';
  if (comingSoon && !stockCountableMatching) {
    return zero('COMING_SOON');
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

  if (input.matching.strategy === 'void') {
    // comingSoon 인 void 는 위 stockCountableMatching 게이트에서 이미 끊겼다.
    return {
      ...base,
      sellableQuantity: unboundedQuantity,
      stockBoundQuantity: unboundedQuantity,
      isSellable: true,
      reason: 'SELLABLE',
      components: componentResults(input.components, unboundedQuantity),
    };
  }

  if (input.matching.strategy !== 'variant') {
    return zero('MATCHING_STRATEGY_UNSUPPORTED');
  }

  if (input.components.length === 0) {
    return zero('MATCHING_LINK_MISSING');
  }

  const components = componentResults(input.components);
  const stockBoundQuantity = Math.min(...components.map((component) => component.componentSellableQuantity));

  // 항상 판매는 재고량과 무관하다 — 재고가 남아 있다고 stock-gated(SELLABLE) 로 내보내면
  // Medusa 가 manage_inventory=true 로 잡고 예약분을 차감해, "재고는 있는데 전량 예약" 구간에서
  // 품절로 노출된다. 재고 유무보다 먼저 판정해야 플래그가 의도대로 동작한다.
  if (input.matching.alwaysSellableZeroStock && !comingSoon) {
    return {
      ...base,
      sellableQuantity: unboundedQuantity,
      stockBoundQuantity,
      isSellable: true,
      reason: 'ALWAYS_SELLABLE_ZERO_STOCK',
      components,
    };
  }

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

  if (input.matching.preStockSellable && !comingSoon) {
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
    // 같은 0이어도 사유를 갈라둔다 — 스토어프론트 문구("곧 출시 예정" vs "품절")와
    // 로그 판독이 이 reason 에 걸린다.
    reason: comingSoon ? 'COMING_SOON' : 'INSUFFICIENT_COMPONENT_STOCK',
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
