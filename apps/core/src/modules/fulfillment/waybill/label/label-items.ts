/** 송장 품목 줄 한 줄(스펙 §10.1). 송장이 피킹 지시서라 «어디서 무엇을 몇 개» 가 한 줄이다. */
export interface LabelItem {
  locationCode: string;
  skuId: string;
  name: string;
  quantity: number;
}

/** 배정 행 한 줄 — `WaybillReader.loadLabelAllocation` 이 읽는다. */
export interface AllocatedLabelRow {
  locationCode: string;
  skuId: string;
  skuName: string;
  qty: number;
}

const codepoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 배정 행을 (로케이션, SKU) 로 합친다 — 한 SKU 가 출고 줄 여럿(FOI 별)이어도 같은 곳에서 집는 동작은 하나다.
 * 로케이션 코드 순(동선이 코드 순이다) → 이름순 → skuId 순. 입력 순서에 흔들리지 않는다(지문이 이 순서를 먹는다).
 */
export function labelItemsOf(rows: readonly AllocatedLabelRow[]): LabelItem[] {
  const byKey = new Map<string, LabelItem>();
  for (const row of rows) {
    const key = `${row.locationCode}\u0000${row.skuId}`;
    const prev = byKey.get(key);
    if (prev) prev.quantity += row.qty;
    else byKey.set(key, { locationCode: row.locationCode, skuId: row.skuId, name: row.skuName, quantity: row.qty });
  }
  return [...byKey.values()].sort(
    (a, b) =>
      codepoint(a.locationCode, b.locationCode) || a.name.localeCompare(b.name, 'ko') || codepoint(a.skuId, b.skuId),
  );
}

/** perPage 개씩 쪽으로 나눈다. 빈 목록도 한 쪽 — 라벨은 늘 1장 이상이다. */
export function paginate<T>(items: readonly T[], perPage: number): T[][] {
  if (perPage < 1) throw new Error(`paginate: perPage must be >= 1, got ${perPage}`);
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages.length ? pages : [[]];
}
