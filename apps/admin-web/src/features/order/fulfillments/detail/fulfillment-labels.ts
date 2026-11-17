import { stateLabel } from '@/lib/api/domains/orders/order-progress.shape';

// 출고주문 상세가 서버 값을 그대로 보이지 않게 하는 이름표. 모르는 값은 그대로 보인다.
function labelOf(labels: Record<string, string>, value: string): string {
  return labels[value] ?? value;
}

const SHIPMENT_STATUS: Record<string, string> = {
  draft: '계획 전',
  planned: '계획 확정',
  shipped: '출고 완료',
  in_transit: '배송 중',
  delivered: '배송 완료',
  failed: '배송 실패',
  canceled: '취소됨',
  superseded: '쓰지 않음',
  recovery_required: '복구 필요',
};

export const shipmentStatusLabel = (status: string) =>
  labelOf(SHIPMENT_STATUS, status);

/** 상자가 멈춘 이유(합포장·취소·회수 재처리 대기) */
export const recoveryLabel = (code: string) => stateLabel(code);

const WAYBILL_STATUS: Record<string, string> = {
  pending: '발급 중',
  allocated: '택배사 등록 중',
  registered: '사용 가능',
  used: '출고에 씀',
  voided: '무효',
  failed: '발급 실패',
  abandoned: '중단함',
};

export const waybillStatusLabel = (status: string) =>
  labelOf(WAYBILL_STATUS, status);

const CARRIER: Record<string, string> = {
  CJ: 'CJ대한통운',
  HANJIN: '한진택배',
  LOTTE: '롯데택배',
  LOGEN: '로젠택배',
  KDEXP: '경동택배',
  CJGLS: 'CJ GLS',
  EPOST: '우체국택배',
  DAESIN: '대신택배',
  ILYANG: '일양로지스',
  HDEXP: '합동택배',
  CVSNET: 'GS 편의점택배',
  CUPOST: 'CU 편의점택배',
  CHUNIL: '천일택배',
  KUNYOUNG: '건영택배',
};

export const carrierLabel = (carrier: string) => labelOf(CARRIER, carrier);

const DISPATCH_ATTEMPT_STATUS: Record<string, string> = {
  pending: '출고 처리 중',
  dispatched: '출고됨',
  recalled: '되돌림',
  recovery_required: '복구 필요',
};

export const dispatchAttemptStatusLabel = (status: string) =>
  labelOf(DISPATCH_ATTEMPT_STATUS, status);

const OPERATION_TYPE: Record<string, string> = {
  split: '상자 분할',
  consolidate: '합포장',
  recipient_revision: '수령인 변경',
  cancel: '취소',
  reopen: '다시 열기',
  plan: '계획 확정',
  replan: '다시 계획',
  short_pick: '결품 처리',
  recall: '출고 되돌리기',
  amend: '구성 변경',
  force_dispatch: '강제 출고',
};

export const operationTypeLabel = (type: string) =>
  labelOf(OPERATION_TYPE, type);

const RESERVATION_STATUS: Record<string, string> = {
  pending: '확보 중',
  confirmed: '확보됨',
  active: '확보됨',
  released: '풀림',
};

export const reservationStatusLabel = (status: string) =>
  labelOf(RESERVATION_STATUS, status);

const CHANNEL_OPERATION: Record<string, string> = {
  dispatch: '발송 처리',
  delivery: '배송 완료',
  recall: '발송 취소',
};

export const channelOperationLabel = (operation: string) =>
  labelOf(CHANNEL_OPERATION, operation);

const CHANNEL_PROJECTION_STATUS: Record<string, string> = {
  pending: '반영 중',
  succeeded: '반영됨',
  recovery_required: '다시 시도 중',
  manual_adjustment_required: '직접 조정 필요',
};

export const channelProjectionStatusLabel = (status: string) =>
  labelOf(CHANNEL_PROJECTION_STATUS, status);

const BLOCKED_REASON: Record<string, string> = {
  TERMINAL_STATUS: '이미 끝났거나 취소된 출고주문이에요.',
  SHIPPED_EVIDENCE: '이미 출고된 상품이 있어요.',
};

export const blockedReasonLabel = (reason: string) =>
  labelOf(BLOCKED_REASON, reason);

const OUTBOX_EVENT: Record<string, string> = {
  FulfillmentCreated: '출고주문 생성',
  FulfillmentReady: '재고 준비 완료',
  FulfillmentLabelled: '운송장 등록',
  FulfillmentShipped: '출고 완료',
  FulfillmentDelivered: '배송 완료',
  FulfillmentCancelled: '취소',
  ShipmentDispatchRecalled: '출고 되돌림',
  FulfillmentReopened: '남은 수량 다시 열기',
};

export const outboxEventLabel = (eventType: string) =>
  labelOf(OUTBOX_EVENT, eventType);

const OUTBOX_STATUS: Record<string, string> = {
  pending: '보내기 대기',
  processing: '보내는 중',
  published: '보냄',
  failed: '보내지 못함',
  skipped: '건너뜀',
};

export const outboxStatusLabel = (status: string) =>
  labelOf(OUTBOX_STATUS, status);

const ITEM_STATUS: Record<string, string> = {
  created: '확보 전',
  partially_reserved: '부분 확보',
  ready: '확보 완료',
  processing: '처리 중',
  partially_shipped: '일부 출고',
  shipped: '출고 완료',
  completed: '완료',
  canceled: '취소됨',
  recovery_required: '복구 필요',
};

/** 출고주문 상품 줄 상태 */
export const itemStatusLabel = (status: string) => labelOf(ITEM_STATUS, status);
