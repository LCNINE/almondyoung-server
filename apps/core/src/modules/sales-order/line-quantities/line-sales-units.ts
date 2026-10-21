import { ConflictException } from '@nestjs/common';
import { LineQuantities, LineSkuQuantities } from './line-quantities.reader';

type ComposedSku = LineSkuQuantities & { qtyPerUnit: number };

const isComposed = (sku: LineSkuQuantities): sku is ComposedSku => sku.qtyPerUnit !== null;

/**
 * 아직 아무 구성품도 나가지 않은 판매 단위 (K6 PR2b) — V2 «상자 후» 취소의 의미(옛 `outstandingSalesUnits`).
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
