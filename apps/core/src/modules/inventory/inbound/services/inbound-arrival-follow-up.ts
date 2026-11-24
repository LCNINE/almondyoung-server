import { Injectable, Logger } from '@nestjs/common';
import { InboundArrivalReservations } from '../kernel/inbound-arrival-reservations.port';

/**
 * 입고가 커밋된 뒤 할 일 — 들어온 상품을 기다리던 주문의 예약을 바로 잡아, 입고 응답이 돌아온 화면의
 * «미발송 주문»이 크론(10초)을 기다리지 않고 찬다.
 *
 * 입고 트랜잭션 안에서 돌리지 않는다. 입고가 예약 잠금에 묶여 느려지고, 예약이 실패하면 입고까지 되돌아간다.
 * 그래서 트랜잭션 주인(바깥 tx 없이 불린 입고)만 커밋 뒤에 부르고, 바깥 tx 안의 입고는 크론이 맡는다.
 */
@Injectable()
export class InboundArrivalFollowUp {
  private readonly logger = new Logger(InboundArrivalFollowUp.name);

  constructor(private readonly reservations: InboundArrivalReservations) {}

  /** 입고가 커밋된 뒤에 부른다. 던지지 않는다 — 실패는 warn 로그만, 크론이 이어서 채운다. */
  async afterArrival(warehouseId: string, skuIds: readonly string[]): Promise<void> {
    try {
      await this.reservations.retryForSkus(warehouseId, [...new Set(skuIds)]);
    } catch (error) {
      this.logger.warn(
        `Reservation retry after arrival failed (warehouse=${warehouseId}); the retry cron will fill it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
