import { eq } from 'drizzle-orm';
import type { PublisherFor } from '@app/events';
import { CORE_ORDER_STREAM } from '@packages/event-contracts/streams';
import type { SalesOrderClaimProgressedPayload } from '@packages/event-contracts/streams/orders.stream';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';

/**
 * 반품·교환 진행을 고객에게 알리는 `SalesOrderClaimProgressed` 를 아웃박스에 싣는다.
 *
 * 자사몰(medusa) 회원 주문만 싣는다 — 외부 채널 주문이나 회원이 아닌 주문은 알릴 곳이 없다.
 * 멱등키가 `(kind, requestId, stage)` 라 몇 번을 불러도 이벤트는 한 번만 나간다(아웃박스 unique).
 * **진행을 바꾸는 쓰기와 같은 트랜잭션에서 부른다** — 별도 커밋이면 「반품은 됐는데 알림만 유실」되는 창이 생긴다.
 */
export async function enqueueSalesOrderClaimProgress(
  publisher: PublisherFor<typeof CORE_ORDER_STREAM>,
  tx: DbTx,
  claim: Pick<SalesOrderClaimProgressedPayload, 'kind' | 'stage' | 'requestId' | 'requestedBy'> & {
    salesOrderId: string;
    occurredAt: Date;
  },
): Promise<void> {
  const [so] = await tx
    .select({
      channelOrderId: wmsTables.salesOrders.channelOrderId,
      displayOrderNo: wmsTables.salesOrders.displayOrderNo,
      salesChannel: wmsTables.salesOrders.salesChannel,
      customerId: wmsTables.salesOrders.customerId,
      customerEmail: wmsTables.salesOrders.customerEmail,
      customerName: wmsTables.salesOrders.customerName,
    })
    .from(wmsTables.salesOrders)
    .where(eq(wmsTables.salesOrders.id, claim.salesOrderId))
    .limit(1);
  if (!so || so.salesChannel !== 'medusa' || !so.customerId) return;

  await publisher.enqueue(
    {
      idempotencyKey: `so-claim:${claim.kind}:${claim.requestId}:${claim.stage}`,
      eventType: 'SalesOrderClaimProgressed',
      aggregateId: claim.salesOrderId,
      partitionKey: claim.salesOrderId,
      payload: {
        orderId: claim.salesOrderId,
        channelOrderId: so.channelOrderId,
        ...(so.displayOrderNo ? { displayOrderNo: so.displayOrderNo } : {}),
        customerId: so.customerId,
        ...(so.customerEmail ? { customerEmail: so.customerEmail } : {}),
        ...(so.customerName ? { customerName: so.customerName } : {}),
        kind: claim.kind,
        stage: claim.stage,
        requestId: claim.requestId,
        ...(claim.requestedBy ? { requestedBy: claim.requestedBy } : {}),
        occurredAt: claim.occurredAt.toISOString(),
      } satisfies SalesOrderClaimProgressedPayload,
    },
    tx,
  );
}
