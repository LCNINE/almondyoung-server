import type {
  CustomerReturnAttention,
  CustomerReturnPickupStatus,
  CustomerReturnReason,
  CustomerReturnStatus,
} from '@/lib/types/dto/customer-returns';

export const RETURN_STATUS_LABELS: Record<CustomerReturnStatus, string> = {
  expected: '도착 대기',
  arrived: '도착',
  inspected: '정산 중',
  held: '환불 보류',
  refund_pending: '환불 실패',
  settled: '환불 완료',
  cancelled: '취소',
};

/** Medusa 사유 표(apps/medusa/src/workflows/orders/returns/return-reasons.ts RETURN_REASONS)와 이름이 같다. */
export const RETURN_REASON_LABELS: Record<CustomerReturnReason, string> = {
  change_of_mind: '단순 변심',
  defective: '상품 하자',
  not_as_described: '상품 설명과 다름',
  wrong_item: '오배송',
  damaged_in_shipping: '배송 중 파손',
  other: '기타',
};

/** 표 순서. CS 는 customerSelectable 과 무관하게 여섯 다 고른다. */
export const RETURN_REASON_OPTIONS: ReadonlyArray<{
  value: CustomerReturnReason;
  label: string;
}> = [
  { value: 'change_of_mind', label: RETURN_REASON_LABELS.change_of_mind },
  { value: 'defective', label: RETURN_REASON_LABELS.defective },
  { value: 'not_as_described', label: RETURN_REASON_LABELS.not_as_described },
  { value: 'wrong_item', label: RETURN_REASON_LABELS.wrong_item },
  {
    value: 'damaged_in_shipping',
    label: RETURN_REASON_LABELS.damaged_in_shipping,
  },
  { value: 'other', label: RETURN_REASON_LABELS.other },
];

export const RETURN_FEE_BEARER_LABELS: Record<'customer' | 'seller', string> = {
  customer: '고객',
  seller: '판매자',
};

export const RETURN_ATTENTION_LABELS: Record<CustomerReturnAttention, string> =
  {
    held: '보류 판단',
    settlement_failed: '정산 실패',
    prepayment_failed: '선환불 실패',
    partial_arrival: '덜 도착',
    refund_overdue: '환불 기한 지남',
    pickup_failed: '회수 미접수',
  };

export const RETURN_PICKUP_STATUS_LABELS: Record<
  CustomerReturnPickupStatus,
  string
> = {
  pending: '접수 중',
  reserved: '접수됨',
  failed: '접수 실패',
  void: '접수 안 함',
  cancel_pending: '취소 중',
  cancelled: '취소됨',
};

/** CS 버튼 이름 — `availableCustomerReturnActions` 의 kind 와 같은 키 */
export const RETURN_ACTION_LABELS = {
  cancel: '도착 전 취소',
  closeMissing: '미도착으로 닫기',
  settleHeld: '보류 정산',
  prepay: '선환불',
  retrySettlement: '정산 다시 시도',
  manualSettlement: '정산 계좌 송금',
  retryPrepayment: '선환불 다시 시도',
  manualPrepayment: '선환불 계좌 송금',
  retryPickup: '회수 다시 접수',
} as const;
