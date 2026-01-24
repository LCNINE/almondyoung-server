import { InternalOrderEvent, OrderQuery } from '../types';
import { DataType, SyncResult, SyncToChannelPayload } from '../types';
import { ChannelCommand, ChannelQuery } from '../types';

/**
 * 채널 어댑터 인터페이스
 *
 * 어댑터 패턴을 적용하여 각 외부 판매채널의 서로 다른 API 인터페이스를
 * 내부 시스템의 표준 인터페이스로 변환합니다.
 *
 * 각 채널(네이버, 쿠팡 등)은 이 인터페이스를 구현하여
 * 채널별 특수한 API 호출 방식을 내부 표준 형식으로 적응(adapt)시킵니다.
 */
export interface ChannelAdapter {
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
   * 표준 비즈니스 명령을 채널별 API 호출로 번역하는 어댑터의 핵심 역할
   *
   * 🔌 어댑터 패턴의 핵심: 표준 명령 → 채널별 API 호출로 변환
   */
  executeCommand(command: ChannelCommand): Promise<SyncResult>;

  /**
   * 조회성 작업을 처리 (CQRS 패턴 적용)
   * 상태를 변경하지 않는 조회 작업들을 별도로 분리
   */
  executeQuery(query: ChannelQuery): Promise<any>;

  /**
   * 표준화된 쿼리 객체를 사용하여 외부 채널에서 주문 정보를 조회합니다.
   * 모든 채널 어댑터에서 필수로 구현되어야 하는 통합 조회 인터페이스입니다.
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
