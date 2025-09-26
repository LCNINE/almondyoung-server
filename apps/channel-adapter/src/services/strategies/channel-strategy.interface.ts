import { InternalOrderEvent, OrderQuery } from '../../types';
import { DataType, SyncResult, SyncToChannelPayload } from '../../types';
import { ChannelCommand } from '../../types';

export interface ChannelStrategy {
  /**
   * 외부 이벤트를 내부 표준 이벤트로 변환 (웹훅 없이도, 폴링 결과를 이 함수에 태워도 됨)
   */
  processIncomingEvent(event: any): Promise<InternalOrderEvent[]>;

  /**
   * 외부 채널에서 데이터를 수집 (폴링)
   * 예: 네이버 last-changed-statuses → product-orders/query로 상세 조회
   */
  syncFromChannel(dataType: DataType): Promise<InternalOrderEvent[]>;

  /**
   * 내부 데이터를 외부 채널로 동기화 (상태 지향)
   * 예: PIM 상품 정보 변경 → 네이버 상품 업데이트, WMS 재고 변경 → 네이버 재고 업데이트
   */
  syncToChannel(payload: SyncToChannelPayload): Promise<SyncResult>;

  /**
   * 채널별 복잡한 액션(취소/반품/교환/발송 등)을 Command로 통합 처리
   */
  executeCommand(command: ChannelCommand): Promise<SyncResult>;

  /**
   * 표준화된 쿼리 객체를 사용하여 외부 채널에서 주문 정보를 조회합니다.
   * 모든 채널 전략에서 필수로 구현되어야 하는 통합 조회 인터페이스입니다.
   *
   * 🔍 구현 방식:
   * - 쿠팡: 직접 API 호출 (shipmentBoxId, orderId)
   * - 네이버: API 조합 (orderId → productOrderIds → getOrderDetails)
   * - 메두사: 직접 API 호출 (orderId)
   *
   * @param query - 조회 조건을 담은 표준 쿼리 객체
   * @returns 변환된 내부 주문 이벤트 배열. 결과가 없으면 빈 배열을 반환합니다.
   */
  findOrders(query: OrderQuery): Promise<InternalOrderEvent[]>;

  /**
   * 유효성 검증 훅 (옵션)
   */
  validateIncomingData?(data: any): Promise<boolean>;
  validateSyncData?(data: any, dataType: DataType): Promise<boolean>;
}
