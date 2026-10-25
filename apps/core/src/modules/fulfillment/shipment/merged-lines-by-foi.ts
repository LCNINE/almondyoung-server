import type { NewShipmentLine } from './shipment-lifecycle';

export interface MergeableLine {
  id: string;
  fulfillmentOrderItemId: string;
  skuId: string;
  qty: number;
  createdAt: Date;
  demandRequestedAt: Date | null;
}

/** 한 FOI 가 SKU 둘 이상으로 표현돼 있다 — 합칠 수 없다. 호출자가 자기 에러로 옮긴다. */
export class FoiSkuMismatchError extends Error {
  constructor(readonly fulfillmentOrderItemId: string) {
    super(`FOI ${fulfillmentOrderItemId} is represented by multiple SKUs`);
  }
}

export interface MergedLine<L extends MergeableLine> {
  fulfillmentOrderItemId: string;
  sourceLines: L[];
  newLine: NewShipmentLine;
}

/**
 * 여러 상자의 줄을 FOI 당 하나로 합친다(합배송·입점사 합포장 공용, FOI id 순). 수량은 합, `createdFromLineId` 는
 * 원천이 하나일 때만, createdAt·demandRequestedAt 은 가장 이른 값(예약 대기열 순서 키를 잃지 않는다).
 */
export function mergedLinesByFoi<L extends MergeableLine>(lines: readonly L[]): MergedLine<L>[] {
  const grouped = new Map<string, L[]>();
  for (const line of lines)
    grouped.set(line.fulfillmentOrderItemId, [...(grouped.get(line.fulfillmentOrderItemId) ?? []), line]);
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fulfillmentOrderItemId, sourceLines]) => {
      const skuIds = [...new Set(sourceLines.map((line) => line.skuId))];
      if (skuIds.length !== 1) throw new FoiSkuMismatchError(fulfillmentOrderItemId);
      return {
        fulfillmentOrderItemId,
        sourceLines,
        newLine: {
          fulfillmentOrderItemId,
          skuId: skuIds[0],
          qty: sourceLines.reduce((total, line) => total + line.qty, 0),
          createdFromLineId: sourceLines.length === 1 ? sourceLines[0].id : null,
          createdAt: new Date(Math.min(...sourceLines.map((line) => line.createdAt.getTime()))),
          demandRequestedAt: new Date(
            Math.min(...sourceLines.map((line) => (line.demandRequestedAt ?? line.createdAt).getTime())),
          ),
        },
      };
    });
}
