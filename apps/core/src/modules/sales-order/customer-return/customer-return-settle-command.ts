import { eq } from 'drizzle-orm';
import type { PublisherFor } from '@app/events';
import { NotFoundError } from '@app/shared';
import {
  CHANNEL_ORDERS_COMMAND_STREAM,
  SettleChannelReturnPayload,
  channelOrderPartitionKey,
} from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';

/**
 * 검수 결과(SKU 항목)를 채널에 알릴 줄 단위 수령·폐기로 바꾼다 (K8 PR6 N8).
 * 세트 한 벌은 구성품이 하나라도 불량이면 불량이다 — 줄의 폐기 = 그 줄 SKU 항목마다 ceil(불량 / 1벌당 수량) 의 최댓값,
 * 줄 수량을 넘지 않는다. 수령 = 줄 수량 − 폐기. 이 값은 돈을 바꾸지 않는다(수령·폐기 둘 다 환불 대상).
 */
export function toSettleItems(
  lines: Array<{
    channelOrderItemId: string;
    quantity: number;
    items: Array<{ qtyPerUnit: number; rejectedQty: number }>;
  }>,
): SettleChannelReturnPayload['items'] {
  return lines.map((line) => {
    const brokenUnits = Math.max(0, ...line.items.map((item) => Math.ceil(item.rejectedQty / item.qtyPerUnit)));
    const dismissed = Math.min(line.quantity, brokenUnits);
    return { channelOrderItemId: line.channelOrderItemId, received: line.quantity - dismissed, dismissed };
  });
}

/**
 * `SettleChannelReturn` 명령을 아웃박스에 싣는다. 채널·주문번호는 판매주문에서 읽는다.
 * 같은 반품의 n 번째 발행은 키가 `customer-return-settle:<id>:issue:<n>` 이라 한 번만 실린다 — 검수(n=1)와
 * 재발행 크론(n≥2)이 이 함수 하나를 쓴다. requestId 는 늘 반품 id 라 Medusa 가 재전송을 같은 정산으로 잇는다.
 * **정산 칸을 쓰는 전이와 같은 트랜잭션에서 부른다.**
 */
export async function enqueueSettleChannelReturn(
  publisher: PublisherFor<typeof CHANNEL_ORDERS_COMMAND_STREAM>,
  tx: DbTx,
  p: {
    customerReturnId: string;
    salesOrderId: string;
    channelReturnId: string;
    items: SettleChannelReturnPayload['items'];
    refundMode: 'auto' | 'manual';
    issue: number;
  },
): Promise<void> {
  const [so] = await tx
    .select({ salesChannel: wmsTables.salesOrders.salesChannel, channelOrderId: wmsTables.salesOrders.channelOrderId })
    .from(wmsTables.salesOrders)
    .where(eq(wmsTables.salesOrders.id, p.salesOrderId))
    .limit(1);
  if (!so) throw new NotFoundError(`Sales order not found: ${p.salesOrderId}`);

  const key = channelOrderPartitionKey(so.salesChannel, so.channelOrderId);
  await publisher.enqueue(
    {
      idempotencyKey: `customer-return-settle:${p.customerReturnId}:issue:${p.issue}`,
      eventType: 'SettleChannelReturn',
      aggregateId: key,
      partitionKey: key,
      payload: {
        requestId: p.customerReturnId,
        salesChannel: so.salesChannel,
        externalOrderId: so.channelOrderId,
        returnId: p.channelReturnId,
        items: p.items,
        refundMode: p.refundMode,
        requestedAt: new Date().toISOString(),
      } satisfies SettleChannelReturnPayload,
    },
    tx,
  );
}
