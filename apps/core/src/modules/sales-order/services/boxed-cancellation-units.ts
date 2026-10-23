import { BadRequestException, ConflictException } from '@nestjs/common';
import { CompositionItem } from '../../product-matching/line-composition/line-composition';

/**
 * 상자 후 취소의 «판매 단위 ↔ 물리 수량» 환산(#1063 스펙 §6.5). 비율은 라인의 굳힌 구성(qtyPerUnit)에서 읽는다 —
 * 옛 코드는 «FO 항목 수량 ÷ 라인 주문 수량»으로 거꾸로 셌는데, 구성을 바꾼 라인·FO 생성 전 부분 취소가 있던 라인에서
 * 그 역산이 나눠떨어지지 않아 고객 취소가 409 로 거절됐다.
 * «아직 안 나간 판매 단위»(읽기)는 라인 수량 문의 `cancellableSalesUnits` 로 옮겼다(K6 PR2b) — 여기는 FOI 단위 쓰기 배분만 남는다.
 */
export interface LineFulfillmentItem {
  id: string;
  skuId: string;
  qty: number;
  shippedQty: number;
  canceledQty: number;
}

const outstandingOf = (item: LineFulfillmentItem): number => item.qty - item.shippedQty - item.canceledQty;

function itemsByCompositionSku(
  salesOrderLineId: string,
  items: readonly LineFulfillmentItem[],
  composition: readonly CompositionItem[],
): Map<string, LineFulfillmentItem[]> {
  if (composition.length === 0) {
    throw new ConflictException(`Line composition is not frozen for SalesOrder line ${salesOrderLineId}`);
  }
  const skus = new Set(composition.map((entry) => entry.skuId));
  // 구성에서 빠진 SKU 의 항목은 amend 가 qty 를 줄여 미출고 0 으로 남긴다 — 미출고가 남았다면 데이터가 어긋난 것이다
  const stray = items.find((item) => !skus.has(item.skuId) && outstandingOf(item) > 0);
  if (stray) {
    throw new ConflictException(
      `Boxed fulfillment item ${stray.id} is outside the composition of SalesOrder line ${salesOrderLineId}`,
    );
  }
  const bySku = new Map<string, LineFulfillmentItem[]>();
  for (const item of [...items].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!skus.has(item.skuId)) continue;
    bySku.set(item.skuId, [...(bySku.get(item.skuId) ?? []), item]);
  }
  return bySku;
}

/** 판매 단위 units 를 취소할 때 FO 항목마다 뺄 물리 수량. */
export function physicalCancellationByItem(
  salesOrderLineId: string,
  units: number,
  items: readonly LineFulfillmentItem[],
  composition: readonly CompositionItem[],
): Array<{ itemId: string; qty: number }> {
  const bySku = itemsByCompositionSku(salesOrderLineId, items, composition);
  const result: Array<{ itemId: string; qty: number }> = [];
  for (const entry of composition) {
    const candidates = bySku.get(entry.skuId) ?? [];
    let remaining = units * entry.qtyPerUnit;
    const outstanding = candidates.reduce((total, item) => total + outstandingOf(item), 0);
    if (remaining > outstanding) {
      throw new BadRequestException(
        `Cancellation for SalesOrder line ${salesOrderLineId} includes shipped or already canceled quantity; use recall or return`,
      );
    }
    for (const item of candidates) {
      if (remaining === 0) break;
      const qty = Math.min(remaining, outstandingOf(item));
      if (qty === 0) continue;
      result.push({ itemId: item.id, qty });
      remaining -= qty;
    }
  }
  return result;
}
