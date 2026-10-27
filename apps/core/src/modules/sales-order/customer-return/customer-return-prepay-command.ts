import type { PublisherFor } from '@app/events';
import { CHANNEL_ORDERS_COMMAND_STREAM, PrepayChannelReturnPayload } from '@packages/event-contracts/streams';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { channelOrderOf } from './customer-return-settle-command';

/**
 * `PrepayChannelReturn` 명령을 아웃박스에 싣는다 (K8 PR6b N4). 수령 없이 RETURN 환불을 먼저 낸다.
 * 같은 반품의 n 번째 발행은 키가 `customer-return-prepay:<id>:issue:<n>` 이라 한 번만 실린다. requestId 는 늘 반품 id —
 * Medusa 는 requestId·금액·메모로 같은 선환불을 잇는다(메모 `return-prepay:<id>`), 그래서 재발행도 처음 요청의 금액·메모를
 * 그대로 싣는다. 금액이 null 이면 칸을 싣지 않는다(Medusa 기본값 = 품목 값 − 택배비 예상).
 * **선환불 칸을 쓰는 것과 같은 트랜잭션에서 부른다.**
 */
export async function enqueuePrepayChannelReturn(
  publisher: PublisherFor<typeof CHANNEL_ORDERS_COMMAND_STREAM>,
  tx: DbTx,
  p: {
    customerReturnId: string;
    salesOrderId: string;
    channelReturnId: string;
    amount: number | null;
    refundMode: 'auto' | 'manual';
    memo: string;
    issue: number;
  },
): Promise<void> {
  const so = await channelOrderOf(tx, p.salesOrderId);
  await publisher.enqueue(
    {
      idempotencyKey: `customer-return-prepay:${p.customerReturnId}:issue:${p.issue}`,
      eventType: 'PrepayChannelReturn',
      aggregateId: so.partitionKey,
      partitionKey: so.partitionKey,
      payload: {
        requestId: p.customerReturnId,
        salesChannel: so.salesChannel,
        externalOrderId: so.channelOrderId,
        returnId: p.channelReturnId,
        ...(p.amount !== null ? { amount: p.amount } : {}),
        refundMode: p.refundMode,
        memo: p.memo,
        requestedAt: new Date().toISOString(),
      } satisfies PrepayChannelReturnPayload,
    },
    tx,
  );
}
