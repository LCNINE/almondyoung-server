// core 의 sku-delivery-profile.rule.ts 와 같은 판정이다. 서버가 최종 판정자이고 이건 헛걸음 방지용.

export function requiresDeliveryProfile(stockType: string): boolean {
  return stockType === 'physical' || stockType === 'consignment';
}

type ProfileState = { stockType: string; deliveryProfileId: string };

/** '' 은 「프로필 없음」. 수정은 재고 유형이나 프로필이 원래와 달라졌을 때만 판정한다. */
export function deliveryProfileMissing(
  input: ProfileState & { original: ProfileState | null }
): boolean {
  const { original, stockType, deliveryProfileId } = input;
  if (
    original &&
    original.stockType === stockType &&
    original.deliveryProfileId === deliveryProfileId
  ) {
    return false;
  }
  return requiresDeliveryProfile(stockType) && !deliveryProfileId;
}
