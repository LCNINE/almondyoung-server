export interface SkuHolder {
  holderId: string;
  isOurAsset: boolean;
}

export type FulfillmentModeOfHolders =
  | { fulfillmentMode: 'in_house' | '3pl'; ownerId: string | null }
  | { mixed: true };

/**
 * 창고 출고분 SKU 의 화주로 출고 모드를 정한다. 전부 자사면 in_house, 전부 한 위탁 업체면 3pl + 그 화주.
 * 자사와 위탁, 또는 위탁 업체 둘이 한 주문에 섞이면 송장 보내는 분을 하나로 정할 수 없다.
 */
export function fulfillmentModeOfHolders(holders: readonly SkuHolder[]): FulfillmentModeOfHolders {
  const consignment = new Set(holders.filter((h) => !h.isOurAsset).map((h) => h.holderId));

  if (consignment.size === 0) return { fulfillmentMode: 'in_house', ownerId: null };

  if (consignment.size > 1 || holders.some((h) => h.isOurAsset)) return { mixed: true };

  return { fulfillmentMode: '3pl', ownerId: [...consignment][0] };
}
