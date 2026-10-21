import { ConflictException } from '@nestjs/common';
import { LineQuantities, LineSkuQuantities } from './line-quantities.reader';

type ComposedSku = LineSkuQuantities & { qtyPerUnit: number };

const isComposed = (sku: LineSkuQuantities): sku is ComposedSku => sku.qtyPerUnit !== null;

/**
 * 아직 아무 구성품도 나가지 않은 판매 단위 (K6 PR2b) — V2 «상자 후» 취소의 의미(옛 FOI 단위 미출고 환산을 옮겼다).
 * 구성 SKU 마다 outstanding ÷ qtyPerUnit 이 같아야 한다. 조용히 min 을 고르면 세트의 일부 구성품만 취소되므로 거절한다.
 * 판매 단위 환산은 SQL 소비자가 없어 TS 한 벌로 둔다 — 뺄셈(outstanding)은 조각이 이미 했다.
 * skus 가 비면(FO 전) 호출자가 갈래를 정한다 — 여기 오지 않는다.
 */
export function cancellableSalesUnits(line: LineQuantities): number {
  const id = line.salesOrderLineId;
  const composed = line.skus.filter(isComposed);
  if (composed.length === 0) {
    throw new ConflictException(`Line composition is not frozen for SalesOrder line ${id}`);
  }
  // 구성에서 빠진 SKU 의 항목은 amend 가 qty 를 줄여 미출고 0 으로 남긴다 — 미출고가 남았다면 데이터가 어긋난 것이다
  const stray = line.skus.find((sku) => sku.qtyPerUnit === null && sku.outstanding > 0);
  if (stray) {
    throw new ConflictException(
      `V2 fulfillment SKU ${stray.skuId} is outside the composition of SalesOrder line ${id}`,
    );
  }
  const units = composed.map((sku) => {
    if (sku.outstanding % sku.qtyPerUnit !== 0) {
      throw new ConflictException(`V2 progress is not aligned for SalesOrder line ${id}`);
    }
    return sku.outstanding / sku.qtyPerUnit;
  });
  if (new Set(units).size !== 1) {
    throw new ConflictException(`V2 component progress is inconsistent for SalesOrder line ${id}`);
  }
  return units[0];
}

/**
 * 요청의 SKU 수량이 통째 세트 k 개면 k, 아니면 null (K6 PR3a). 구성 SKU 마다 requested ÷ qtyPerUnit 이 같은 정수여야 한다.
 * 구성에 없는 SKU(구성 밖 FOI 포함)가 요청에 있으면 null. 구성이 굳지 않았으면(composed 0) null.
 * 요청에 없는 구성 SKU 는 0 으로 본다 — 그래서 한 구성품만 적은 요청은 세트가 아니다.
 */
export function exactSetUnits(line: LineQuantities, requestedBySku: ReadonlyMap<string, number>): number | null {
  const composed = line.skus.filter(isComposed);
  if (composed.length === 0) return null;
  const composedIds = new Set(composed.map((sku) => sku.skuId));
  if ([...requestedBySku.keys()].some((skuId) => !composedIds.has(skuId))) return null;
  const units = composed.map((sku) => {
    const requested = requestedBySku.get(sku.skuId) ?? 0;
    return requested % sku.qtyPerUnit === 0 ? requested / sku.qtyPerUnit : null;
  });
  const [first] = units;
  return first !== null && units.every((unit) => unit === first) ? first : null;
}

/**
 * 구성 SKU 마다 floor(quantityOf(sku) ÷ qtyPerUnit) 의 최솟값 — 구성품이 모두 갖춰진 세트 수 (K6 PR3a).
 * 구성 밖 SKU 는 보지 않는다. 구성이 굳지 않았으면 0.
 */
export function completedSetUnits(line: LineQuantities, quantityOf: (sku: LineSkuQuantities) => number): number {
  const composed = line.skus.filter(isComposed);
  if (composed.length === 0) return 0;
  return Math.min(...composed.map((sku) => Math.floor(quantityOf(sku) / sku.qtyPerUnit)));
}
