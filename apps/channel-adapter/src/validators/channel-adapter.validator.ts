import { InternalOrderEvent } from '../types';

/**
 * 채널 어댑터 검증 유틸리티
 *
 * 책임:
 * - 공통 검증 로직 중앙화
 * - 일관된 에러 메시지 제공
 * - 검증 로직 재사용성 향상
 */
export class ChannelAdapterValidator {
  /**
   * 이벤트 배열 검증
   *
   * @param events - 검증할 이벤트 배열
   * @throws {Error} 이벤트가 없거나 빈 배열인 경우
   */
  static validateEvents(events: InternalOrderEvent[]): void {
    if (!events || events.length === 0) {
      throw new Error('No events to process');
    }
  }

  /**
   * 주문 이벤트 검증
   *
   * @param event - 검증할 주문 이벤트
   * @throws {Error} 필수 필드가 누락된 경우
   */
  static validateOrderEvent(event: InternalOrderEvent): void {
    if (!event) {
      throw new Error('Order event is required');
    }

    if (!event.externalOrderId) {
      throw new Error('Order ID required');
    }

    if (!event.buyer?.name) {
      throw new Error('Buyer name required');
    }
  }

  /**
   * 채널 파라미터 검증
   *
   * @param channel - 검증할 채널
   * @throws {Error} 채널이 누락된 경우
   */
  static validateChannel(channel: string | undefined): void {
    if (!channel) {
      throw new Error('Channel is required');
    }
  }

  /**
   * 데이터 타입 검증
   *
   * @param dataType - 검증할 데이터 타입
   * @throws {Error} 데이터 타입이 누락된 경우
   */
  static validateDataType(dataType: string | undefined): void {
    if (!dataType) {
      throw new Error('Data type is required');
    }
  }
}
