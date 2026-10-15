import type { CompositionItemInput, CompositionItemView } from '@/lib/types/dto/line-composition';

/** 고른 SKU 와 판매 1개당 수량. 상품매칭 수동 탭과 «이 주문만» 다이얼로그가 같은 목록을 쓴다 */
export interface PickedSku {
  skuId: string;
  skuName: string;
  quantity: number;
}

export type AddPickedResult = { ok: true; list: PickedSku[] } | { ok: false; reason: 'duplicate' };

export function addPicked(list: readonly PickedSku[], sku: { id: string; name: string }): AddPickedResult {
  if (list.some((item) => item.skuId === sku.id)) return { ok: false, reason: 'duplicate' };
  return { ok: true, list: [...list, { skuId: sku.id, skuName: sku.name, quantity: 1 }] };
}

export function removePicked(list: readonly PickedSku[], skuId: string): PickedSku[] {
  return list.filter((item) => item.skuId !== skuId);
}

// core 가 1개당 수량을 양의 정수로만 받는다(COMPOSITION_ITEMS_INVALID) — 입력 중 빈 칸·소수도 여기서 막는다
export function setPickedQuantity(list: readonly PickedSku[], skuId: string, value: number): PickedSku[] {
  const quantity = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
  return list.map((item) => (item.skuId === skuId ? { ...item, quantity } : item));
}

export function pickedFromComposition(items: readonly CompositionItemView[]): PickedSku[] {
  return items.map((item) => ({ skuId: item.skuId, skuName: item.skuName, quantity: item.qtyPerUnit }));
}

export function toCompositionItems(list: readonly PickedSku[]): CompositionItemInput[] {
  return list.map((item) => ({ skuId: item.skuId, qtyPerUnit: item.quantity }));
}
