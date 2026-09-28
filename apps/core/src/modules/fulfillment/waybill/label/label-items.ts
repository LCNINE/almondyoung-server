import type { ManifestLineLite } from '../waybill.types';

/** 운송장 품목 줄 한 줄(#913). 이름은 SKU명 — 라벨이 피킹 지시서라 «집을 물건»이 구별돼야 한다. */
export interface LabelItem {
  name: string;
  quantity: number;
}

/**
 * 출고 품목 줄을 SKU 로 합쳐 이름순으로 늘어놓는다. shipment_lines 는 (출고, FOI) 당 한 줄이라 같은 SKU 가
 * 여러 줄일 수 있다 — 집는 동작은 하나이므로 합친다(스펙 §2). 동명이면 skuId 순 — 입력 순서에 흔들리지 않게.
 */
export function labelItemsOf(lines: readonly Pick<ManifestLineLite, 'skuId' | 'skuName' | 'quantity'>[]): LabelItem[] {
  const bySku = new Map<string, { skuId: string; name: string; quantity: number }>();
  for (const line of lines) {
    const prev = bySku.get(line.skuId);
    if (prev) prev.quantity += line.quantity;
    else bySku.set(line.skuId, { skuId: line.skuId, name: line.skuName, quantity: line.quantity });
  }
  return [...bySku.values()]
    .sort((a, b) => a.name.localeCompare(b.name, 'ko') || (a.skuId < b.skuId ? -1 : a.skuId > b.skuId ? 1 : 0))
    .map(({ name, quantity }) => ({ name, quantity }));
}

/** perPage 개씩 쪽으로 나눈다. 빈 목록도 한 쪽 — 라벨은 늘 1장 이상이다. */
export function paginate<T>(items: readonly T[], perPage: number): T[][] {
  if (perPage < 1) throw new Error(`paginate: perPage must be >= 1, got ${perPage}`);
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages.length ? pages : [[]];
}
