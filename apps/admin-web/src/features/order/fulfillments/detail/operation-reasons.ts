/** 사람이 아닌 자동 처리가 남기는 행위자 id — core 와 같은 값(parity 스펙) */
export const FULFILLMENT_SYSTEM_ACTOR_ID =
  '00000000-0000-4000-8000-000000000010';

export type ReasonedOperationType =
  | 'split'
  | 'recipient_revision'
  | 'consolidate'
  | 'force_dispatch'
  | 'recall'
  | 'short_pick';

export type RequestChannel =
  | 'kakao'
  | 'phone'
  | 'store_inquiry'
  | 'marketplace_inquiry'
  | 'other';

export type OperationReasonOption = {
  code: string;
  label: string;
  customerRequest: boolean;
};

export type OperationReasonValue = {
  reasonCode?: string;
  requestChannel?: string;
  otherText: string;
  note: string;
};

export type OperationReasonPayload = {
  reason: string;
  reasonCode?: string;
  requestChannel?: string;
  note?: string;
};

// 되돌리기·결품은 서버가 사유 글에 문구가 아닌 코드를 그대로 남긴다(창고 앱 호환)
export const OPERATION_REASONS: Record<
  ReasonedOperationType,
  ReadonlyArray<OperationReasonOption>
> = {
  split: [
    {
      code: 'customer_ship_first',
      label: '고객이 일부 먼저 보내 달라고 요청',
      customerRequest: true,
    },
    {
      code: 'ship_available_first',
      label: '일부 상품 재고가 늦어 있는 것부터 보냄',
      customerRequest: false,
    },
    {
      code: 'does_not_fit',
      label: '한 상자에 다 들어가지 않음',
      customerRequest: false,
    },
    { code: 'other', label: '기타', customerRequest: false },
  ],
  recipient_revision: [
    {
      code: 'customer_address_change',
      label: '고객이 주소·연락처 변경 요청',
      customerRequest: true,
    },
    {
      code: 'address_correction',
      label: '주소 오류 정정(택배사·주소 확인 결과)',
      customerRequest: false,
    },
    { code: 'other', label: '기타', customerRequest: false },
  ],
  consolidate: [
    {
      code: 'customer_ship_together',
      label: '고객이 함께 보내 달라고 요청',
      customerRequest: true,
    },
    {
      code: 'same_address',
      label: '같은 주소 주문을 합침',
      customerRequest: false,
    },
    { code: 'other', label: '기타', customerRequest: false },
  ],
  force_dispatch: [
    {
      code: 'customer_urgent',
      label: '고객이 급하게 보내 달라고 요청',
      customerRequest: true,
    },
    {
      code: 'scan_unavailable',
      label: '바코드·스캔 불가',
      customerRequest: false,
    },
    {
      code: 'inspected_otherwise',
      label: '검수를 다른 방법으로 끝냄',
      customerRequest: false,
    },
    { code: 'other', label: '기타', customerRequest: false },
  ],
  recall: [
    {
      code: 'carrier_handoff_failed',
      label: '택배사 인계 실패',
      customerRequest: false,
    },
    { code: 'dispatch_mistake', label: '출고 오류', customerRequest: false },
    { code: 'address_correction', label: '주소 수정', customerRequest: false },
    { code: 'package_recovered', label: '상자 회수', customerRequest: false },
  ],
  short_pick: [
    { code: 'inventory_shortage', label: '재고 부족', customerRequest: false },
    { code: 'item_damaged', label: '상품 파손', customerRequest: false },
    { code: 'quality_defect', label: '품질 불량', customerRequest: false },
    { code: 'expired_stock', label: '유효기간 만료', customerRequest: false },
  ],
};

export const REQUEST_CHANNEL_OPTIONS: ReadonlyArray<{
  code: RequestChannel;
  label: string;
}> = [
  { code: 'kakao', label: '카카오 상담' },
  { code: 'phone', label: '전화' },
  { code: 'store_inquiry', label: '쇼핑몰 1:1 문의' },
  { code: 'marketplace_inquiry', label: '마켓 문의' },
  { code: 'other', label: '기타' },
];

/** 주문 취소 창의 사유 코드 */
const CANCEL_LABELS: Record<string, string> = {
  CUSTOMER_REQUEST: '고객 요청',
  OUT_OF_STOCK: '재고 부족',
  ADMIN_REQUEST: '관리자 처리',
  CHANNEL_CANCEL: '채널 취소',
  PAYMENT_FAILED: '결제 실패',
  OTHER: '기타',
  CHANNEL_FULL_CANCEL: '쇼핑몰 전체 취소',
  'Sales order cancellation': '주문 취소',
};

/** 자동 기록이 남기는 분류 코드 */
const AUTOMATIC_LABELS: Record<string, string> = {
  system_plan: '계획 확정',
  channel_order_modified: '쇼핑몰 주문 변경',
  line_composition_operator: '상품 구성 변경',
  line_composition_matching_applied: '상품 매칭 반영',
};

const CODE_LABELS: ReadonlyMap<string, string> = new Map([
  ...Object.values(OPERATION_REASONS).flatMap((options) =>
    options.map((o): [string, string] => [o.code, o.label])
  ),
  ...Object.entries(AUTOMATIC_LABELS),
  ...Object.entries(CANCEL_LABELS),
]);

function isReasonedType(type: string): type is ReasonedOperationType {
  return Object.prototype.hasOwnProperty.call(OPERATION_REASONS, type);
}

/** 코드를 아는 만큼 이름표로, 모르면 저장된 사유 글 그대로 */
export function operationReasonLabel(
  type: string,
  reasonCode: string | null | undefined,
  reason: string
): string {
  if (!reasonCode) return reason;
  if (type === 'cancel') {
    return CANCEL_LABELS[reasonCode] ?? CODE_LABELS.get(reasonCode) ?? reason;
  }
  if (isReasonedType(type)) {
    const own = OPERATION_REASONS[type].find((o) => o.code === reasonCode);
    if (own) return own.label;
  }
  return CODE_LABELS.get(reasonCode) ?? reason;
}

export function requestChannelLabel(code: string | null | undefined): string {
  if (!code) return '';
  return REQUEST_CHANNEL_OPTIONS.find((c) => c.code === code)?.label ?? code;
}

export function isCustomerRequestReason(
  type: ReasonedOperationType,
  code: string | undefined
): boolean {
  return OPERATION_REASONS[type].some(
    (o) => o.code === code && o.customerRequest
  );
}

export function canSubmitOperationReason(
  type: ReasonedOperationType,
  value: OperationReasonValue
): boolean {
  const { reasonCode } = value;
  if (!reasonCode) return false;
  if (!OPERATION_REASONS[type].some((o) => o.code === reasonCode)) return false;
  if (isCustomerRequestReason(type, reasonCode) && !value.requestChannel) {
    return false;
  }
  if (reasonCode === 'other' && !value.otherText.trim()) return false;
  return true;
}

/** 비어 있는 값은 키를 넣지 않는다 */
export function toOperationReasonPayload(
  type: ReasonedOperationType,
  value: OperationReasonValue
): OperationReasonPayload {
  const option = OPERATION_REASONS[type].find(
    (o) => o.code === value.reasonCode
  );
  const reason =
    value.reasonCode === 'other'
      ? value.otherText.trim()
      : (option?.label ?? '');
  const payload: OperationReasonPayload = { reason };
  if (value.reasonCode) payload.reasonCode = value.reasonCode;
  if (value.requestChannel && isCustomerRequestReason(type, value.reasonCode)) {
    payload.requestChannel = value.requestChannel;
  }
  const note = value.note.trim();
  if (note) payload.note = note;
  return payload;
}
