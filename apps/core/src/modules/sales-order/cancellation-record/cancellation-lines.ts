import type { CancellationShipmentPhase } from '../../inventory/schema/inventory.schema';

export type CancellationEffect = {
  type: string;
  targetType?: string;
  targetId?: string;
  targetExternalRef?: string;
  count?: number;
  metadata?: Record<string, unknown>;
};

export type CancellationLineContext = { id: string; quantity: number; isDigital: boolean };

export type CancellationLineDraft = {
  salesOrderLineId: string;
  quantity: number;
  shipmentPhase: CancellationShipmentPhase;
};

export class CancellationLineDerivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CancellationLineDerivationError';
  }
}

const PRESERVED_SHIPPED_EFFECT = 'preserved_shipped_fulfillment_order_item';

type DeriveInput = {
  scope: 'full' | 'partial';
  /** 취소 행 metadata.cancelledLines 그대로. 없으면 null. */
  cancelledLines: Array<{ salesOrderLineId: string; quantity: number }> | null;
  effects: CancellationEffect[];
  /** 그 주문의 전체 판매 라인. */
  lines: CancellationLineContext[];
  /** 이 취소 이전의 라인별 취소 합(갈래 무관). */
  priorCancelledByLine: Map<string, number>;
};

/**
 * 취소가 라인별로 몇 개를 출고 전/후 어느 갈래로 취소했는지 도출한다 (순수 함수).
 * 쓰기 문과 백필이 같은 함수를 쓴다 — 두 경로의 해석이 갈리지 않게.
 * 구성품이 하나라도 나간 판매 단위는 출고 후로 센다.
 */
export function deriveCancellationLines(input: DeriveInput): CancellationLineDraft[] {
  const lineById = new Map(input.lines.map((line) => [line.id, line]));
  const before = new Map<string, number>();
  const after = new Map<string, number>();
  const add = (target: Map<string, number>, lineId: string, quantity: number) => {
    if (quantity > 0) target.set(lineId, (target.get(lineId) ?? 0) + quantity);
  };

  if (input.scope === 'partial' || input.cancelledLines) {
    const requested = new Map<string, number>();
    for (const entry of input.cancelledLines ?? []) {
      if (!lineById.has(entry.salesOrderLineId)) {
        throw new CancellationLineDerivationError(`취소 항목의 판매 라인을 찾을 수 없다: ${entry.salesOrderLineId}`);
      }
      if (entry.quantity > 0) {
        requested.set(entry.salesOrderLineId, (requested.get(entry.salesOrderLineId) ?? 0) + entry.quantity);
      }
    }
    for (const [lineId, quantity] of requested) {
      // partial 만 출고 후 효과를 가진다. full 은 출고된 게 있으면 애초에 막힌다.
      const shipped = input.scope === 'partial' ? deriveShippedUnits(lineId, quantity, input.effects) : 0;
      if (shipped > quantity) {
        throw new CancellationLineDerivationError(
          `출고 후 수량(${shipped})이 취소 수량(${quantity})보다 크다: ${lineId}`,
        );
      }
      add(after, lineId, shipped);
      add(before, lineId, quantity - shipped);
    }
    if (input.scope === 'full') {
      for (const line of input.lines) {
        if (requested.has(line.id) || !line.isDigital) continue;
        add(before, line.id, line.quantity - (input.priorCancelledByLine.get(line.id) ?? 0));
      }
    }
  } else {
    for (const line of input.lines) {
      add(before, line.id, line.quantity - (input.priorCancelledByLine.get(line.id) ?? 0));
    }
  }

  const drafts: CancellationLineDraft[] = [];
  for (const [lineId, quantity] of after) {
    drafts.push({ salesOrderLineId: lineId, quantity, shipmentPhase: 'after_shipment' });
  }
  for (const [lineId, quantity] of before) {
    drafts.push({ salesOrderLineId: lineId, quantity, shipmentPhase: 'before_shipment' });
  }

  const totals = new Map<string, number>();
  for (const draft of drafts) add(totals, draft.salesOrderLineId, draft.quantity);
  for (const [lineId, total] of totals) {
    const line = lineById.get(lineId);
    const prior = input.priorCancelledByLine.get(lineId) ?? 0;
    if (!line || prior + total > line.quantity) {
      throw new CancellationLineDerivationError(
        `라인 취소 합이 주문 수량을 넘는다: ${lineId} (이전 ${prior} + 이번 ${total} > ${line?.quantity ?? '없음'})`,
      );
    }
  }

  return drafts.sort((a, b) =>
    a.salesOrderLineId === b.salesOrderLineId
      ? a.shipmentPhase.localeCompare(b.shipmentPhase)
      : a.salesOrderLineId < b.salesOrderLineId
        ? -1
        : 1,
  );
}

/** 라인의 출고 후 판매 단위 수 = SKU 별 ceil(Σ affectedShipped ÷ 단위당 수량) 의 최댓값. */
function deriveShippedUnits(lineId: string, cancelledQuantity: number, effects: CancellationEffect[]): number {
  const perSku = new Map<string, { shipped: number; requested: number }>();
  for (const effect of effects) {
    if (effect.type !== PRESERVED_SHIPPED_EFFECT) continue;
    const metadata = effect.metadata ?? {};
    if (metadata.salesOrderLineId !== lineId) continue;
    const skuId = metadata.skuId;
    const requested = metadata.requestedFulfillmentQuantity;
    const shipped = metadata.affectedShippedQuantity;
    if (typeof skuId !== 'string' || typeof requested !== 'number' || typeof shipped !== 'number') {
      throw new CancellationLineDerivationError(`출고 후 보존 효과의 수량 필드가 숫자가 아니다: ${lineId}`);
    }
    const current = perSku.get(skuId);
    perSku.set(skuId, { shipped: (current?.shipped ?? 0) + shipped, requested });
  }

  let units = 0;
  for (const { shipped, requested } of perSku.values()) {
    if (cancelledQuantity <= 0 || requested % cancelledQuantity !== 0) {
      throw new CancellationLineDerivationError(
        `requestedFulfillmentQuantity(${requested})가 취소 수량(${cancelledQuantity})으로 나누어떨어지지 않는다: ${lineId}`,
      );
    }
    const perUnit = requested / cancelledQuantity;
    if (perUnit <= 0) {
      throw new CancellationLineDerivationError(`판매 단위당 SKU 수량이 0 이하다: ${lineId}`);
    }
    units = Math.max(units, Math.ceil(shipped / perUnit));
  }
  return units;
}
