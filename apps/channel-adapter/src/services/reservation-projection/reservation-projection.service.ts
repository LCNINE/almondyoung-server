import { Injectable } from '@nestjs/common';
import type { SalesOrderLineReservationStatePayload } from '@packages/event-contracts/streams/orders.stream';
import { reservationTarget } from './reservation-target';
import { SellableSettleGate } from './sellable-settle-gate';

export type LineState = SalesOrderLineReservationStatePayload['lines'][number];
export type ReservationWrite = { lineItemId: string; quantity: number; allowDecrease: boolean };

/** 이벤트 소비자와 하루 대사가 함께 쓰는 «줄 상태 → Medusa 쓰기» 변환 (#1247). */
@Injectable()
export class ReservationProjectionService {
  constructor(private readonly gate: SellableSettleGate) {}

  async toWrites(lines: LineState[], asOf: Date, now: Date): Promise<ReservationWrite[]> {
    const managed = lines.filter(
      (line): line is LineState & { channelOrderItemId: string } => line.channelOrderItemId !== null,
    );
    const blocked = await this.gate.blockedVariantIds(
      managed.map((line) => line.variantId),
      asOf,
      now,
    );
    return managed.map((line) => ({
      lineItemId: line.channelOrderItemId,
      quantity: reservationTarget(line),
      allowDecrease: !blocked.has(line.variantId),
    }));
  }
}
