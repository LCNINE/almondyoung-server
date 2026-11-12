import { BadRequestError } from '@app/shared';
import type { ShipmentOperationType } from 'apps/core/src/modules/inventory/schema/inventory.schema';

export type ReasonedOperationType =
  | 'split'
  | 'recipient_revision'
  | 'consolidate'
  | 'force_dispatch'
  | 'recall'
  | 'short_pick';

export type RequestChannel = 'kakao' | 'phone' | 'store_inquiry' | 'marketplace_inquiry' | 'other';

export type ResolvedOperationReason = {
  reason: string;
  reasonCode: string | null;
  requestChannel: RequestChannel | null;
};

export type OperationReasonOption = { code: string; label: string; customerRequest: boolean };

export const SHIPMENT_OPERATION_REASONS: Record<ReasonedOperationType, ReadonlyArray<OperationReasonOption>> = {
  split: [
    { code: 'customer_ship_first', label: '고객이 일부 먼저 보내 달라고 요청', customerRequest: true },
    { code: 'ship_available_first', label: '일부 상품 재고가 늦어 있는 것부터 보냄', customerRequest: false },
    { code: 'does_not_fit', label: '한 상자에 다 들어가지 않음', customerRequest: false },
    { code: 'other', label: '기타', customerRequest: false },
  ],
  recipient_revision: [
    { code: 'customer_address_change', label: '고객이 주소·연락처 변경 요청', customerRequest: true },
    { code: 'address_correction', label: '주소 오류 정정(택배사·주소 확인 결과)', customerRequest: false },
    { code: 'other', label: '기타', customerRequest: false },
  ],
  consolidate: [
    { code: 'customer_ship_together', label: '고객이 함께 보내 달라고 요청', customerRequest: true },
    { code: 'same_address', label: '같은 주소 주문을 합침', customerRequest: false },
    { code: 'other', label: '기타', customerRequest: false },
  ],
  force_dispatch: [
    { code: 'customer_urgent', label: '고객이 급하게 보내 달라고 요청', customerRequest: true },
    { code: 'scan_unavailable', label: '바코드·스캔 불가', customerRequest: false },
    { code: 'inspected_otherwise', label: '검수를 다른 방법으로 끝냄', customerRequest: false },
    { code: 'other', label: '기타', customerRequest: false },
  ],
  recall: [
    { code: 'carrier_handoff_failed', label: '택배사 인계 실패', customerRequest: false },
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

export const REQUEST_CHANNELS: ReadonlyArray<{ code: RequestChannel; label: string }> = [
  { code: 'kakao', label: '카카오 상담' },
  { code: 'phone', label: '전화' },
  { code: 'store_inquiry', label: '쇼핑몰 1:1 문의' },
  { code: 'marketplace_inquiry', label: '마켓 문의' },
  { code: 'other', label: '기타' },
];

export const REQUEST_CHANNEL_CODES: readonly RequestChannel[] = REQUEST_CHANNELS.map((c) => c.code);

const CANCEL_CUSTOMER_REQUEST = 'CUSTOMER_REQUEST';
/** `shipment_operations.reason_code` 칸 길이 */
const OPERATION_REASON_CODE_MAX = 64;

/** 주문 취소 창의 사유 코드와 자동 취소 경로가 쓰는 코드. */
const CANCEL_CODES: ReadonlySet<string> = new Set([
  'CUSTOMER_REQUEST',
  'OUT_OF_STOCK',
  'ADMIN_REQUEST',
  'CHANNEL_CANCEL',
  'PAYMENT_FAILED',
  'OTHER',
  'CHANNEL_FULL_CANCEL',
  'Sales order cancellation',
]);

/** 코드 없이 저장된 자동 기록의 고정 문자열 → 분류 코드(읽기 전용). */
const LEGACY_REASON_CODES: ReadonlyMap<string, string> = new Map([
  ['Shipment planned', 'system_plan'],
  ['CHANNEL_ORDER_MODIFIED', 'channel_order_modified'],
  ['출고 준비: 있는 것만 먼저 보내기', 'ship_available_first'],
  ['LINE_COMPOSITION_OPERATOR', 'line_composition_operator'],
  ['LINE_COMPOSITION_MATCHING_APPLIED', 'line_composition_matching_applied'],
  ['동일 수령인 합포장', 'same_address'],
]);

/** 사유 글에 코드 문자열을 그대로 두는 작업(창고 앱·기존 판독 호환). */
const KEEPS_CODE_AS_REASON: ReadonlySet<ShipmentOperationType> = new Set(['recall', 'short_pick']);

function isReasonedType(type: ShipmentOperationType): type is ReasonedOperationType {
  return Object.prototype.hasOwnProperty.call(SHIPMENT_OPERATION_REASONS, type);
}

function isRequestChannel(value: string): value is RequestChannel {
  return REQUEST_CHANNEL_CODES.some((code) => code === value);
}

function parseRequestChannel(value: string | undefined): RequestChannel | null {
  if (value === undefined) return null;
  if (!isRequestChannel(value)) throw new BadRequestError(`Unknown request channel: ${value}`);
  return value;
}

export function isCustomerRequestReason(type: ShipmentOperationType, code: string): boolean {
  if (type === 'cancel') return code === CANCEL_CUSTOMER_REQUEST;
  if (!isReasonedType(type)) return false;
  return SHIPMENT_OPERATION_REASONS[type].some((r) => r.code === code && r.customerRequest);
}

export function resolveOperationReason(
  type: ShipmentOperationType,
  input: { reason: string; reasonCode?: string; requestChannel?: string },
): ResolvedOperationReason {
  const { reason, reasonCode } = input;
  if (reasonCode === undefined) return { reason, reasonCode: null, requestChannel: null };

  if (type === 'cancel') {
    // 고객·쇼핑몰 수집·옛 화면의 취소는 경로 없이 온다 — 경로는 받되 요구하지 않는다
    const channel = parseRequestChannel(input.requestChannel);
    // 작업 기록 칸보다 긴 주문 취소 코드는 코드 없이 남긴다 — 사유 글은 지금처럼 남는다
    const storedCode = reasonCode.length <= OPERATION_REASON_CODE_MAX ? reasonCode : null;
    return {
      reason,
      reasonCode: storedCode,
      requestChannel: isCustomerRequestReason(type, reasonCode) ? channel : null,
    };
  }

  if (!isReasonedType(type)) throw new BadRequestError(`Reason code is not accepted for ${type}`);
  const option = SHIPMENT_OPERATION_REASONS[type].find((r) => r.code === reasonCode);
  if (!option) throw new BadRequestError(`Unknown reason code for ${type}: ${reasonCode}`);

  const requestChannel = option.customerRequest ? requireChannel(input.requestChannel) : null;
  if (reasonCode === 'other') {
    const text = reason.trim();
    if (!text) throw new BadRequestError('Reason text is required for the other option');
    return { reason: text, reasonCode, requestChannel };
  }
  return { reason: KEEPS_CODE_AS_REASON.has(type) ? reasonCode : option.label, reasonCode, requestChannel };
}

function requireChannel(value: string | undefined): RequestChannel {
  const channel = parseRequestChannel(value);
  if (!channel) throw new BadRequestError('Request channel is required for a customer request');
  return channel;
}

export function classifyOperationReason(
  type: ShipmentOperationType,
  stored: { reasonCode: string | null; reason: string },
): string | null {
  if (stored.reasonCode) return stored.reasonCode;
  const legacy = LEGACY_REASON_CODES.get(stored.reason);
  if (legacy) return legacy;
  if (type === 'cancel') return CANCEL_CODES.has(stored.reason) ? stored.reason : null;
  if (type === 'recall' || type === 'short_pick') {
    return SHIPMENT_OPERATION_REASONS[type].some((r) => r.code === stored.reason) ? stored.reason : null;
  }
  return null;
}
