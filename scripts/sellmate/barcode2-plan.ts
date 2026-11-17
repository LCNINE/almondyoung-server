/**
 * 셀메이트 «바코드번호2» 를 core 보조 바코드(is_primary=false)로 배정하는 규칙 (#1356).
 * 가져오기(import-products.ts)와 백필(backfill-barcode2.ts)이 함께 쓴다. DB 를 모르는 순수 함수다.
 *
 * 대표 바코드 규칙은 그대로다 — 바코드번호2 는 대표가 비어 있어도 대표로 올리지 않는다.
 */

/** 한 품목의 대표(바코드번호)·보조(바코드번호2) 값. 빈 문자열 = 없음. */
export interface Barcode2Want {
  skuId: string;
  primary: string;
  secondary: string;
}

export interface Barcode2Plan {
  insert: { skuId: string; barcode: string }[];
  alreadyOk: number;
  conflicts: { skuId: string; barcode: string; ownerSkuId: string }[];
}

/**
 * taken: 바코드 값 → 소유 SKU id (DB 의 현재 상태). 바꾸지 않는다.
 *
 * 같은 값을 한 SKU 의 대표와 다른 SKU 의 보조가 함께 원하면 대표가 이긴다 — 그래서 대표를 먼저 훑어
 * 선점해 두고 보조를 배정한다. 보조끼리는 먼저 온 쪽이 갖는다.
 */
export function planSecondaryBarcodes(
  wants: readonly Barcode2Want[],
  taken: ReadonlyMap<string, string>,
): Barcode2Plan {
  const plan: Barcode2Plan = { insert: [], alreadyOk: 0, conflicts: [] };
  const claimed = new Map<string, string>();

  for (const { skuId, primary } of wants) {
    if (primary && !taken.has(primary) && !claimed.has(primary)) {
      claimed.set(primary, skuId);
    }
  }

  for (const { skuId, primary, secondary } of wants) {
    if (!secondary || secondary === primary) {
      continue;
    }

    const owner = taken.get(secondary) ?? claimed.get(secondary);

    if (owner === skuId) {
      plan.alreadyOk++;
    } else if (owner !== undefined) {
      plan.conflicts.push({ skuId, barcode: secondary, ownerSkuId: owner });
    } else {
      claimed.set(secondary, skuId);
      plan.insert.push({ skuId, barcode: secondary });
    }
  }

  return plan;
}
