/**
 * 주문 이벤트 리스너 (슈도코드)
 *
 * 이 파일은 Kafka 연동 시 구현될 예정입니다.
 * 현재는 아키텍처 설계와 인터페이스 정의 목적으로 작성되었습니다.
 *
 * TODO: Kafka 연동 시 구현
 * - @nestjs/microservices의 @MessagePattern 또는
 * - KafkaJS 직접 사용
 * - Idempotency 체크 로직 구현
 * - DLQ(Dead Letter Queue) 및 재시도 정책
 */
import { Injectable, Logger } from '@nestjs/common';
import { PointService } from '../services/points/point.service';

/**
 * 주문 완료 이벤트 스키마
 * Topic: orders.events.v1.order_completed
 */
interface OrderCompletedEvent {
  orderId: string;
  customerId: string;
  totalAmount: number;
  earnPoints: number; // 메두사가 계산한 적립 포인트
  reason: string;
  completedAt: string;
}

/**
 * 주문 취소 이벤트 스키마
 * Topic: orders.events.v1.order_cancelled
 */
interface OrderCancelledEvent {
  orderId: string;
  customerId: string;
  cancelReason: string;
  cancelledAt: string;
}

@Injectable()
export class OrderEventsListener {
  private readonly logger = new Logger(OrderEventsListener.name);

  constructor(private readonly pointService: PointService) {}

  /**
   * 주문 완료 시 포인트 적립
   *
   * 처리 단계:
   * 1. 이벤트 검증 (필수 필드 확인)
   * 2. 중복 적립 방지 (idempotency check by orderId)
   * 3. pointService.addPoints() 호출
   * 4. 성공 로그 기록
   *
   * @example
   * // Kafka consumer 설정 예시:
   * @MessagePattern('orders.events.v1.order_completed')
   * async handleOrderCompleted(@Payload() event: OrderCompletedEvent) {
   *   await this.onOrderCompleted(event);
   * }
   */
  async onOrderCompleted(event: OrderCompletedEvent): Promise<void> {
    // 1. 이벤트 검증
    if (!event.customerId || !event.earnPoints || event.earnPoints <= 0) {
      this.logger.warn(
        `Invalid order completed event: ${JSON.stringify(event)}`,
      );
      return;
    }

    this.logger.log(
      `주문 완료 이벤트 수신: orderId=${event.orderId}, earnPoints=${event.earnPoints}`,
    );

    // 2. 중복 적립 방지
    // TODO: orderId 기반 idempotency 체크
    // const alreadyProcessed = await this.checkIdempotency(event.orderId);
    // if (alreadyProcessed) {
    //   this.logger.log(`Already processed: ${event.orderId}`);
    //   return;
    // }

    try {
      // 3. 포인트 적립
      const result = await this.pointService.addPoints({
        partnerId: Number(event.customerId),
        amount: event.earnPoints,
        reason: 'PURCHASE',
        orderId: event.orderId,
        memo: `주문 완료 적립: ${event.orderId}`,
      });

      // 4. 성공 로그
      this.logger.log(
        `포인트 적립 완료: ${event.earnPoints}원 (주문: ${event.orderId}, eventId: ${result.eventId})`,
      );

      // TODO: 적립 성공 이벤트 발행 (선택적)
      // await this.publishPointsEarnedEvent({
      //   orderId: event.orderId,
      //   pointEventId: result.eventId,
      //   amount: event.earnPoints
      // });
    } catch (error) {
      this.logger.error(`포인트 적립 실패: ${event.orderId}`, error.stack);
      // TODO: 실패 시 DLQ(Dead Letter Queue) 또는 재시도 정책
      throw error;
    }
  }

  /**
   * 주문 취소 시 적립 포인트 취소
   *
   * 처리 단계:
   * 1. 이벤트 검증
   * 2. 중복 처리 방지
   * 3. 원본 적립 이벤트 조회
   * 4. pointService.cancelPoints() 호출
   * 5. 성공 로그 기록
   *
   * @example
   * // Kafka consumer 설정 예시:
   * @MessagePattern('orders.events.v1.order_cancelled')
   * async handleOrderCancelled(@Payload() event: OrderCancelledEvent) {
   *   await this.onOrderCancelled(event);
   * }
   */
  async onOrderCancelled(event: OrderCancelledEvent): Promise<void> {
    // 1. 이벤트 검증
    if (!event.customerId || !event.orderId) {
      this.logger.warn(
        `Invalid order cancelled event: ${JSON.stringify(event)}`,
      );
      return;
    }

    this.logger.log(`주문 취소 이벤트 수신: orderId=${event.orderId}`);

    // 2. 중복 처리 방지
    // TODO: orderId 기반 idempotency 체크
    // const alreadyProcessed = await this.checkCancellationIdempotency(event.orderId);
    // if (alreadyProcessed) {
    //   this.logger.log(`Already cancelled: ${event.orderId}`);
    //   return;
    // }

    try {
      // 3. 원본 적립 이벤트 조회
      // TODO: orderId로 원본 point_events 조회
      // const originalEvent = await this.findPointEventByOrderId(event.orderId);
      // if (!originalEvent) {
      //   this.logger.warn(`No point event found for order: ${event.orderId}`);
      //   return;
      // }

      // 4. 포인트 취소
      // const result = await this.pointService.cancelPoints({
      //   partnerId: Number(event.customerId),
      //   eventIdToCancel: originalEvent.id,
      //   reason: 'ORDER_CANCELLED',
      //   memo: `주문 취소: ${event.orderId}`,
      // });

      // 5. 성공 로그
      // this.logger.log(
      //   `적립 포인트 취소 완료: (주문: ${event.orderId}, eventId: ${result.eventId})`,
      // );

      this.logger.log(
        `주문 취소 처리 완료: orderId=${event.orderId} (구현 예정)`,
      );
    } catch (error) {
      this.logger.error(`적립 포인트 취소 실패: ${event.orderId}`, error.stack);
      // TODO: 실패 시 DLQ 또는 재시도 정책
      throw error;
    }
  }

  /**
   * Idempotency 체크 (중복 처리 방지)
   * TODO: 구현 필요
   */
  // private async checkIdempotency(orderId: string): Promise<boolean> {
  //   // DB에 orderId 기반 처리 기록 확인
  //   // 예: idempotency_keys 테이블 또는 별도 처리 기록 테이블
  //   return false;
  // }
}
