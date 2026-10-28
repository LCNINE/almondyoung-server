import { asc, eq } from 'drizzle-orm';
import type { PublisherFor } from '@app/events';
import { NotFoundError } from '@app/shared';
import {
  CHANNEL_ORDERS_COMMAND_STREAM,
  SettleChannelReturnPayload,
  channelOrderPartitionKey,
} from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import type { CustomerReturnSettlement } from './customer-return.types';

type SettleLine = {
  channelOrderItemId: string;
  quantity: number;
  /** 미도착으로 닫은 수량(N8) — 정산에 싣지 않는다 */
  missingQty: number;
  items: Array<{ qtyPerUnit: number; rejectedQty: number; heldQty: number }>;
};

/**
 * 검수 결과(SKU 항목)를 채널에 알릴 줄 단위 수령·폐기로 바꾼다 (K8 PR6 N8, PR6b N8·N14).
 * 줄 수량 = 반품 수량 − 미도착으로 닫은 수량, 0 인 줄은 싣지 않는다.
 * 세트 한 벌은 구성품이 하나라도 불량·보류면 폐기다 — 줄의 폐기 = 그 줄 SKU 항목마다 ceil((불량 + 보류) / 1벌당 수량)
 * 의 최댓값, 줄 수량을 넘지 않는다. 수령 = 줄 수량 − 폐기. 이 값은 돈을 바꾸지 않는다(수령·폐기 둘 다 환불 대상).
 */
export function toSettleItems(lines: SettleLine[]): SettleChannelReturnPayload['items'] {
  return lines.flatMap((line) => {
    const quantity = line.quantity - line.missingQty;
    if (quantity <= 0) return [];
    const brokenUnits = Math.max(
      0,
      ...line.items.map((item) => Math.ceil((item.rejectedQty + item.heldQty) / item.qtyPerUnit)),
    );
    const dismissed = Math.min(quantity, brokenUnits);
    return [{ channelOrderItemId: line.channelOrderItemId, received: quantity - dismissed, dismissed }];
  });
}

/** 검수가 적은 SKU 항목의 불량·보류와 줄의 미도착 수량을 줄마다 모은다 — 검수·보류 정산·재발행이 같은 입력을 쓴다 */
export async function loadSettleLines(trx: DbTx, customerReturnId: string): Promise<SettleLine[]> {
  const i = wmsTables.customerReturnItems;
  const l = wmsTables.customerReturnLines;
  const rows = await trx
    .select({
      lineId: l.id,
      channelOrderItemId: l.channelOrderItemId,
      lineQuantity: l.quantity,
      missingQty: l.missingQty,
      qtyPerUnit: i.qtyPerUnit,
      rejectedQty: i.rejectedQty,
      heldQty: i.heldQty,
    })
    .from(i)
    .innerJoin(l, eq(l.id, i.customerReturnLineId))
    .where(eq(l.customerReturnId, customerReturnId))
    .orderBy(asc(l.channelOrderItemId), asc(i.skuId));
  const byLine = new Map<string, SettleLine>();
  for (const row of rows) {
    const line: SettleLine = byLine.get(row.lineId) ?? {
      channelOrderItemId: row.channelOrderItemId,
      quantity: row.lineQuantity,
      missingQty: row.missingQty,
      items: [],
    };
    line.items.push({ qtyPerUnit: row.qtyPerUnit, rejectedQty: row.rejectedQty ?? 0, heldQty: row.heldQty ?? 0 });
    byLine.set(row.lineId, line);
  }
  return [...byLine.values()];
}

/** 반품 명령이 실을 채널·주문번호와 파티션 키 — 판매주문에서 읽는다 */
export async function channelOrderOf(
  tx: DbTx,
  salesOrderId: string,
): Promise<{ salesChannel: string; channelOrderId: string; partitionKey: string }> {
  const [so] = await tx
    .select({ salesChannel: wmsTables.salesOrders.salesChannel, channelOrderId: wmsTables.salesOrders.channelOrderId })
    .from(wmsTables.salesOrders)
    .where(eq(wmsTables.salesOrders.id, salesOrderId))
    .limit(1);
  if (!so) throw new NotFoundError(`Sales order not found: ${salesOrderId}`);
  return { ...so, partitionKey: channelOrderPartitionKey(so.salesChannel, so.channelOrderId) };
}

/**
 * `SettleChannelReturn` 명령을 아웃박스에 싣는다. 채널·주문번호는 판매주문에서 읽는다.
 * 같은 반품의 n 번째 발행은 키가 `customer-return-settle:<id>:issue:<n>` 이라 한 번만 실린다 — 검수·보류 정산(n=1)과
 * 재발행 크론(n≥2)이 이 함수 하나를 쓴다. requestId 는 늘 반품 id 라 Medusa 가 재전송을 같은 정산으로 잇는다.
 * CS 입력(`command` — 보류 차감·상계·미도착)은 정산 칸에 저장된 그대로 싣는다. 재발행도 같은 값을 내야 한다.
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
    command: CustomerReturnSettlement['command'];
    issue: number;
  },
): Promise<void> {
  const so = await channelOrderOf(tx, p.salesOrderId);
  const command = p.command ?? {};
  await publisher.enqueue(
    {
      idempotencyKey: `customer-return-settle:${p.customerReturnId}:issue:${p.issue}`,
      eventType: 'SettleChannelReturn',
      aggregateId: so.partitionKey,
      partitionKey: so.partitionKey,
      payload: {
        requestId: p.customerReturnId,
        salesChannel: so.salesChannel,
        externalOrderId: so.channelOrderId,
        returnId: p.channelReturnId,
        items: p.items,
        refundMode: p.refundMode,
        ...(command.holdDeduction ? { holdDeduction: command.holdDeduction } : {}),
        ...(command.alreadyRefundedAmount !== undefined
          ? { alreadyRefundedAmount: command.alreadyRefundedAmount }
          : {}),
        ...(command.closesMissing ? { closesMissing: true } : {}),
        requestedAt: new Date().toISOString(),
      } satisfies SettleChannelReturnPayload,
    },
    tx,
  );
}
