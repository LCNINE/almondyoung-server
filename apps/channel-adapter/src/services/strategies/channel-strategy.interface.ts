import { InternalOrderEvent, OrderQuery } from '../../types';
import { DataType, SyncResult, SyncToChannelPayload } from '../../types';
import { ChannelCommand, ChannelQuery } from '../../types';
import { SalesOrder } from '../apis/wms.api.service';

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
   * 표준 비즈니스 명령을 채널별 API 호출로 번역하는 어댑터의 핵심 역할
   */
  executeCommand(command: ChannelCommand): Promise<SyncResult>;

  /**
   * 조회성 작업을 처리 (CQRS 패턴 적용)
   * 상태를 변경하지 않는 조회 작업들을 별도로 분리
   */
  executeQuery(query: ChannelQuery): Promise<any>;

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

  // ===== WMS 연동 메서드 (CTO SoT 원칙) =====

  /**
   * 채널 주문을 WMS에 전달 (어댑터가 SoT → 동기 요청)
   *
   * CTO SoT 원칙에 따라 어댑터가 SoT인 판매채널 주문을 WMS에 동기 요청으로 전달합니다.
   * 각 채널별로 주문 데이터 형식이 다르므로 Strategy에서 변환 로직을 담당합니다.
   *
   * @param orderEvent 채널에서 수신한 주문 이벤트
   * @returns WMS에서 생성된 판매주문 정보
   *
   * @example
   * ```typescript
   * // 쿠팡에서 새 주문 수신 시
   * const wmsOrder = await strategy.createOrderInWms(coupangOrderEvent);
   *
   * // 네이버에서 새 주문 수신 시
   * const wmsOrder = await strategy.createOrderInWms(naverOrderEvent);
   * ```
   */
  createOrderInWms(orderEvent: InternalOrderEvent): Promise<SalesOrder>;

  /**
   * WMS 주문 상태 업데이트 (어댑터가 SoT → 동기 요청)
   *
   * 채널에서 주문 상태 변경 요청이 들어왔을 때 WMS에 반영합니다.
   *
   * @param orderEvent 주문 상태 변경 이벤트
   * @returns 업데이트된 WMS 주문 정보
   */
  updateOrderInWms(orderEvent: InternalOrderEvent): Promise<SalesOrder>;

  /**
   * WMS 주문 취소 (어댑터가 SoT → 동기 요청)
   *
   * 채널에서 취소 요청이 들어왔을 때 WMS에 취소 요청을 전달합니다.
   *
   * @param orderEvent 주문 취소 이벤트
   * @param reason 취소 사유 (선택사항)
   * @returns 취소된 WMS 주문 정보
   */
  cancelOrderInWms(
    orderEvent: InternalOrderEvent,
    reason?: string,
  ): Promise<SalesOrder>;

  /**
   * 교환 요청 처리 (어댑터가 SoT → 동기 요청)
   *
   * CTO 가이드라인: "교환은 주문 내에서 일어나는 동작입니다. 주문은 취소되거나 새로 생성될 일이 없습니다."
   * 따라서 교환은 기존 주문을 수정하는 방식으로 처리합니다.
   *
   * @param exchangeEvent 교환 요청 이벤트
   * @returns 교환 처리된 WMS 주문 정보
   */
  processExchangeInWms(exchangeEvent: InternalOrderEvent): Promise<SalesOrder>;

  /**
   * 유효성 검증 훅 (옵션)
   */
  validateIncomingData?(data: any): Promise<boolean>;
  validateSyncData?(data: any, dataType: DataType): Promise<boolean>;
}
