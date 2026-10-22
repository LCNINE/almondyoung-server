import { and, eq, type InferInsertModel } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { isDigitalFulfillmentLine } from '../../product-matching/line-composition/line-composition';
import { sumCancelledByLine } from '../../product-matching/line-composition/partial-cancellation';
import {
  CancellationEffect,
  CancellationLineDerivationError,
  deriveCancellationLines,
  RequestedCancellationLine,
} from './cancellation-lines';

export type { RequestedCancellationLine } from './cancellation-lines';

type SalesOrderCancellationInsert = InferInsertModel<typeof wmsTables.salesOrderCancellations>;
type SalesOrderCancellation = typeof wmsTables.salesOrderCancellations.$inferSelect;

/**
 * 판매주문 취소를 기록하는 단 하나의 문 (K6).
 * 취소 행과 그 취소가 라인별로 어느 갈래(출고 전/후)에서 몇 개를 뺐는지를 호출자 트랜잭션 안에서 함께 쓴다.
 * 도출이 실패하면(`CancellationLineDerivationError`) 그대로 올려 호출자 트랜잭션을 롤백시킨다 —
 * 프로그램 불변식 위반이라 도메인 예외로 바꾸지 않는다(앞단 검사가 같은 조건을 이미 400 으로 거른다).
 *
 * 취소할 라인은 `requestedLines` 로만 받는다(V1 전체취소는 null). 취소 수량의 기록은 라인 행 하나뿐이라
 * 취소 행 metadata 에 `cancelledLines` 를 싣는 호출은 거절한다 — 실으면 기록이 다시 두 벌이 된다 (K6 PR6).
 */
export async function recordSalesOrderCancellation(
  trx: DbTx,
  values: SalesOrderCancellationInsert,
  requestedLines: readonly RequestedCancellationLine[] | null,
): Promise<SalesOrderCancellation> {
  if (isRecord(values.metadata) && 'cancelledLines' in values.metadata) {
    throw new CancellationLineDerivationError('취소 라인은 metadata 가 아니라 requestedLines 인자로 넘긴다');
  }
  const salesLines = await trx
    .select({
      id: wmsTables.salesOrderLines.id,
      quantity: wmsTables.salesOrderLines.quantity,
      fulfillmentKind: wmsTables.salesOrderLines.fulfillmentKind,
      requiresShipping: wmsTables.salesOrderLines.requiresShipping,
    })
    .from(wmsTables.salesOrderLines)
    .where(eq(wmsTables.salesOrderLines.salesOrderId, values.salesOrderId));
  // 새 취소 행을 넣기 전에 읽어야 이번 취소가 prior 에 섞이지 않는다.
  const priorCancelledByLine = await loadPriorCancelledByLine(trx, values.salesOrderId);

  const drafts = deriveCancellationLines({
    scope: values.cancellationScope ?? 'full',
    requestedLines,
    effects: readEffects(values.effects),
    lines: salesLines.map((line) => ({
      id: line.id,
      quantity: line.quantity,
      isDigital: isDigitalFulfillmentLine(line),
    })),
    priorCancelledByLine,
  });

  const [cancellation] = await trx.insert(wmsTables.salesOrderCancellations).values(values).returning();
  if (drafts.length > 0) {
    await trx.insert(wmsTables.salesOrderCancellationLines).values(
      drafts.map((draft) => ({
        cancellationId: cancellation.id,
        salesOrderId: values.salesOrderId,
        salesOrderLineId: draft.salesOrderLineId,
        quantity: draft.quantity,
        shipmentPhase: draft.shipmentPhase,
      })),
    );
  }
  return cancellation;
}

/**
 * 이 주문에서 이미 취소된 라인별 수량(갈래 무관).
 * 라인 행이 있는 취소는 그 행을, 라인 행이 없는 옛 partial 취소(백필 전)는 `metadata.cancelledLines` 를 쓴다 —
 * 같은 취소를 두 번 세지 않는다.
 */
async function loadPriorCancelledByLine(trx: DbTx, salesOrderId: string): Promise<Map<string, number>> {
  const lineRows = await trx
    .select({
      cancellationId: wmsTables.salesOrderCancellationLines.cancellationId,
      salesOrderLineId: wmsTables.salesOrderCancellationLines.salesOrderLineId,
      quantity: wmsTables.salesOrderCancellationLines.quantity,
    })
    .from(wmsTables.salesOrderCancellationLines)
    .where(eq(wmsTables.salesOrderCancellationLines.salesOrderId, salesOrderId));
  const partials = await trx
    .select({
      id: wmsTables.salesOrderCancellations.id,
      metadata: wmsTables.salesOrderCancellations.metadata,
    })
    .from(wmsTables.salesOrderCancellations)
    .where(
      and(
        eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId),
        eq(wmsTables.salesOrderCancellations.cancellationScope, 'partial'),
      ),
    );

  const withLines = new Set(lineRows.map((row) => row.cancellationId));
  const prior = sumCancelledByLine(
    partials.filter((partial) => !withLines.has(partial.id)).map((partial) => partial.metadata),
  );
  for (const row of lineRows) {
    prior.set(row.salesOrderLineId, (prior.get(row.salesOrderLineId) ?? 0) + row.quantity);
  }
  return prior;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 쓰는 쪽이 넘긴 effects(jsonb). 도출이 읽는 것은 type 과 metadata 뿐이다. */
function readEffects(effects: unknown): CancellationEffect[] {
  if (effects === undefined) return [];
  if (!Array.isArray(effects)) {
    throw new CancellationLineDerivationError('취소 effects 가 배열이 아니다');
  }
  return effects.map((effect: unknown) => {
    if (!isRecord(effect) || typeof effect.type !== 'string') {
      throw new CancellationLineDerivationError(`취소 effect 형식이 아니다: ${JSON.stringify(effect)}`);
    }
    return { type: effect.type, metadata: isRecord(effect.metadata) ? effect.metadata : undefined };
  });
}
