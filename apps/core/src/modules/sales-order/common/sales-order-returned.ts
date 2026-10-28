import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PublisherFor } from '@app/events';
import { CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import type { SalesOrderReturnedPayload } from '@packages/event-contracts/streams/orders.stream';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { readLineQuantities } from '../line-quantities/line-quantities.reader';
import { completedSetUnits } from '../line-quantities/line-sales-units';

const logger = new Logger('SalesOrderReturned');

/**
 * 반품 완료를 알리는 `SalesOrderReturned` 를 아웃박스에 싣는다(소비자: ugc 리뷰 적립 회수).
 * 반품 기록의 정산 완료(K8 PR6)가 부른다(옛 반품 표의 완료 경로는 K8 PR 10 에서 걷었다).
 *
 * `lines` 는 이 반품이 닿은 주문 라인 — 라인마다 한 번. 멱등키가 `so-returned:<returnRequestId>` 라
 * 몇 번을 불러도 한 번만 나간다. **반품을 완료 상태로 바꾼 쓰기와 같은 트랜잭션에서 부른다** —
 * 같은 트랜잭션의 수량 문(`returnConsumed`)이 방금 바뀐 상태를 읽어야 한다.
 */
export async function enqueueSalesOrderReturned(
  publisher: PublisherFor<typeof CORE_ORDER_STREAM>,
  tx: DbTx,
  p: {
    salesOrderId: string;
    returnRequestId: string;
    reason: SalesOrderReturnedPayload['reason'];
    reasonDetail?: string;
    returnedAt: Date;
    lines: Array<{ salesOrderLineId: string; channelOrderItemId: string | null; orderedQuantity: number }>;
  },
): Promise<void> {
  if (p.lines.length === 0) {
    logger.warn(`[ReturnCompleted] No resolvable lines for return ${p.returnRequestId}; event not published.`);
    return;
  }
  const salesOrder = await tx
    .select({ channelOrderId: wmsTables.salesOrders.channelOrderId })
    .from(wmsTables.salesOrders)
    .where(eq(wmsTables.salesOrders.id, p.salesOrderId))
    .limit(1)
    .then((rows) => rows[0]);

  // 「이 건의 수량」이 아니라 **그 주문 라인의 완료 반품에서 통째로 돌아온 세트 수**를 싣는다(C7). 이 반품은
  // 방금 완료로 바뀌었으므로 같은 트랜잭션의 수량 문(`returnConsumed`)에 이미 들어 있다. 나눠 반품해도,
  // 이벤트가 재전달돼도 소비자가 상태 없이 같은 판정을 내릴 수 있게 하는 것이 이 필드의 목적이다.
  // 세트 일부만 돌아온 라인은 0 이라 아래에서 빠진다 — 적립을 과하게 회수하지 않는다(스펙 §6.5).
  const lineQuantities = await readLineQuantities(tx, p.salesOrderId);
  const returnedSets = (lineId: string): number => {
    const line = lineQuantities.get(lineId);
    return line ? completedSetUnits(line, (sku) => sku.returnConsumed) : 0;
  };

  const returnedLines = p.lines
    .map((line) => {
      const remaining = lineQuantities.get(line.salesOrderLineId)?.remaining;
      return {
        salesOrderLineId: line.salesOrderLineId,
        channelOrderItemId: line.channelOrderItemId ?? undefined,
        orderedQuantity: line.orderedQuantity,
        returnedQuantity: returnedSets(line.salesOrderLineId),
        // 주문 − 취소 전부. 출고 뒤 취소가 있으면 소비자가 전량 반품을 이 값으로 판정한다(U3).
        // 음수(초과 취소)는 데이터 오류지만 Wallet 이 이미 환불한 뒤라 발행이 계약 검증에서 죽으면 안 된다 — 0 으로 낸다
        remainingQuantity: remaining === undefined ? undefined : Math.max(0, remaining),
      };
    })
    .filter((line) => line.returnedQuantity > 0);

  if (returnedLines.length === 0) {
    logger.warn(`[ReturnCompleted] No completed return quantity for return ${p.returnRequestId}; event not published.`);
    return;
  }

  await publisher.enqueue(
    {
      idempotencyKey: `so-returned:${p.returnRequestId}`,
      eventType: 'SalesOrderReturned',
      aggregateId: p.salesOrderId,
      partitionKey: p.salesOrderId,
      payload: {
        orderId: p.salesOrderId,
        channelOrderId: salesOrder?.channelOrderId ?? undefined,
        returnRequestId: p.returnRequestId,
        reason: p.reason,
        reasonDetail: p.reasonDetail,
        returnedAt: p.returnedAt.toISOString(),
        returnedLines,
      } satisfies SalesOrderReturnedPayload,
    },
    tx,
  );
}
