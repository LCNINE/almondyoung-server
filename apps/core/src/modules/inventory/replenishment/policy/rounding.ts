/**
 * 발주량 올림. 스펙 §5.3 — MOQ 이상으로 올린 뒤 상자(packing_unit) 배수로 다시 올린다.
 * 순수 함수: Nest · drizzle 을 모른다.
 */
export interface LotConstraint {
  moq: number | null;
  packingUnit: number | null;
}

export function roundUpToLot(qty: number, lot: LotConstraint): number {
  if (!(qty > 0)) return 0;
  let result = Math.ceil(qty);
  const moq = lot.moq !== null && lot.moq > 0 ? lot.moq : null;
  const unit = lot.packingUnit !== null && lot.packingUnit > 0 ? lot.packingUnit : null;
  if (moq !== null && result < moq) result = moq;
  if (unit !== null) result = Math.ceil(result / unit) * unit;
  return result;
}
