import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { ConflictError, NotFoundError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { selectFrozenCompositions } from '../../product-matching/line-composition/frozen-compositions';
import { selectEntrancePassword } from '../../fulfillment/services/entrance-password.selection';
import { ExchangeShipmentOpener } from '../../fulfillment/exchange-shipment/exchange-shipment-opener';
import { readPickupSource } from './customer-return-pickup-source.reader';

export type CustomerExchangeReleaseInput = { customerReturnId: string; actorId: string | null };

/**
 * 교환 상자 열기 (K8 PR11 N13) — 교환 줄(같은 판매주문의 0원 줄, 접수가 만든다)을 다시 보낸다. 출고 쪽 쓰기(FOI·draft 상자·
 * 예약·투영)는 출고 모듈의 `ExchangeShipmentOpener` 가 한다 — 판매주문 코드는 출고 표를 직접 쓰지 않는다.
 * 재고가 모자라면 덜 잡힌 draft 로 남는다(던지지 않는다) — 지금의 예약 재시도·나눠 보내기가 이어받는다.
 * 부르는 곳: 검수(보류 없음)·CS [교환품 보내기]. 둘 다 반품 기록을 잠근 트랜잭션 안에서 부른다.
 * `exchange_released_at/by` 가 멱등을 진다 — 이미 열렸거나 반품(kind return)이면 아무것도 하지 않고 false.
 */
@Injectable()
export class CustomerExchangeReleaser {
  constructor(private readonly shipments: ExchangeShipmentOpener) {}

  async release(trx: DbTx, input: CustomerExchangeReleaseInput): Promise<boolean> {
    // 반품 기록을 먼저 잠근다 — 취소 사실(`recordCancelled`)도 같은 행을 잠그고 열린 교환이면 거절한다(N16)
    const [record] = await trx
      .select({
        id: wmsTables.customerReturns.id,
        salesOrderId: wmsTables.customerReturns.salesOrderId,
        kind: wmsTables.customerReturns.kind,
        status: wmsTables.customerReturns.status,
        exchangeReleasedAt: wmsTables.customerReturns.exchangeReleasedAt,
      })
      .from(wmsTables.customerReturns)
      .where(eq(wmsTables.customerReturns.id, input.customerReturnId))
      .for('update');
    if (!record) throw new NotFoundError(`Customer return not found: ${input.customerReturnId}`);
    if (record.kind !== 'exchange' || record.exchangeReleasedAt !== null) return false;
    if (record.status === 'cancelled') throw new ConflictError(`Customer exchange ${record.id} is cancelled`);

    const [salesOrder] = await trx
      .select({
        id: wmsTables.salesOrders.id,
        shippingAddress: wmsTables.salesOrders.shippingAddress,
        orderDate: wmsTables.salesOrders.orderDate,
        entrancePassword: wmsTables.salesOrders.entrancePassword,
      })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, record.salesOrderId))
      .for('update');
    if (!salesOrder) {
      throw new Error(`Sales order ${record.salesOrderId} vanished under customer exchange ${record.id}`);
    }

    const exchangeLines = await this.loadExchangeLines(trx, record.id);
    if (exchangeLines.length === 0) throw new Error(`Customer exchange ${record.id} has no exchange lines`);
    // 접수가 원래 줄의 굳은 구성을 복사했다(N12)
    const compositions = await selectFrozenCompositions(
      trx,
      exchangeLines.map((line) => line.id),
    );
    // 받는 사람 = 회수지와 같은 주소(배송완료 상자의 스냅샷). 못 찾으면 판매주문 주소
    const pickup = await readPickupSource(trx, record.id);
    await this.shipments.open(trx, {
      salesOrderId: salesOrder.id,
      lines: exchangeLines.map((line) => ({
        salesOrderLineId: line.id,
        variantId: line.variantId,
        quantity: line.quantity,
        composition: compositions.get(line.id) ?? [],
      })),
      recipientSnapshot:
        pickup.kind === 'ok' && pickup.snapshot !== null ? pickup.snapshot : salesOrder.shippingAddress,
      entrancePassword: selectEntrancePassword([
        { orderDate: salesOrder.orderDate, entrancePassword: salesOrder.entrancePassword },
      ]),
    });

    const now = new Date();
    await trx
      .update(wmsTables.customerReturns)
      .set({ exchangeReleasedAt: now, exchangeReleasedBy: input.actorId, updatedAt: now })
      .where(eq(wmsTables.customerReturns.id, record.id));
    return true;
  }

  /** 이 교환의 교환 줄 — 반품 줄마다 하나(접수가 만든다, N12) */
  private async loadExchangeLines(
    trx: DbTx,
    customerReturnId: string,
  ): Promise<Array<{ id: string; variantId: string; quantity: number }>> {
    const sol = wmsTables.salesOrderLines;
    const crl = wmsTables.customerReturnLines;
    return trx
      .select({ id: sol.id, variantId: sol.variantId, quantity: sol.quantity })
      .from(sol)
      .innerJoin(crl, eq(crl.id, sol.exchangeReturnLineId))
      .where(eq(crl.customerReturnId, customerReturnId))
      .orderBy(asc(sol.id));
  }
}
