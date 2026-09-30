import type { ReturnBinContents, ReturnBinItem } from './returnBinApi';

/** 바코드가 여러 SKU 후보에 걸려도 합치지 않는다 — 줄마다 자기 상품명을 들고 있다(어느 SKU 인지는 서버가 정한다). */
export interface PutawayTarget {
  locations: Array<{ key: string; skuName: string; locationCode: string; qty: number }>;
}

/** 화면은 셋 중 하나를 기다린다 — 바구니, 상품, 로케이션. 스캔은 지금 단계의 것으로만 읽는다(접두어 분류 없음). */
export type PutawayStep =
  | { kind: 'bin' }
  | { kind: 'product'; bin: ReturnBinContents }
  | { kind: 'location'; bin: ReturnBinContents; productBarcode: string; target: PutawayTarget };

/** 스캔한 상품(바코드 → SKU 후보)의 원래 로케이션들. 바구니에 없으면 null. */
export function pickTarget(bin: ReturnBinContents, skuIds: string[]): PutawayTarget | null {
  const items = bin.items.filter((item) => skuIds.includes(item.skuId));
  if (!items.length) return null;
  return {
    locations: items.map((item) => ({
      key: `${item.sourceLocationId}|${item.skuId}`,
      skuName: item.skuName,
      locationCode: item.locationCode,
      qty: item.qty,
    })),
  };
}

/** 적치 뒤 — 바구니가 비었으면 다음 바구니, 아니면 같은 바구니의 다음 상품. */
export function afterPutaway(bin: ReturnBinContents, items: ReturnBinItem[]): PutawayStep {
  return items.length ? { kind: 'product', bin: { ...bin, items } } : { kind: 'bin' };
}
