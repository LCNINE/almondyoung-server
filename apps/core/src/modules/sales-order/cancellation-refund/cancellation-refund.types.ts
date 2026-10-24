import type { StoreRefundStatus } from '../dto/store-order-actions.dto';

/**
 * 취소가 환불을 «언제» 하나 (K7 PR4, 스펙 §5.5).
 * - immediate: 취소 확정 뒤 곧바로 Wallet 환불을 시도한다(고객 셀프 취소).
 * - decide_later: 취소만 확정하고 환불은 관리자가 목록에서 결정한다(운영자 취소).
 */
export type RefundPolicy = 'immediate' | 'decide_later';

/**
 * 환불 링크(`cancellation_linked_wallet_refund`)에만 쓰는 상태. 고객에게 보이는 `StoreRefundStatus` 에는 넣지 않는다 —
 * 두 값은 «아직 안 했다 / 안 하기로 했다» 는 내부 기록이고 고객 화면의 환불 단계가 아니다.
 */
export const REFUND_REQUESTED = 'requested';
export const REFUND_WAIVED = 'waived';

export type RefundLinkStatus = StoreRefundStatus | typeof REFUND_REQUESTED | typeof REFUND_WAIVED;
