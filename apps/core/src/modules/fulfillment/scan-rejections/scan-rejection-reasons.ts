import { HttpException, HttpStatus } from '@nestjs/common';
import { ConflictError } from '@app/shared';

/** 관리자 화면이 사유 옆에 붙일 동작 — 이 상자를 어디서 풀지 고른다. */
export type ScanRejectionAction = 'release_tote' | 'check_waybill' | 'handoff_worker' | 'review_box';

export interface ScanRejectionReason {
  message: string;
  action: ScanRejectionAction;
}

/**
 * 작업자가 그 자리에서 풀거나 다시 하면 되는 거절 — 관리자 화면에 남기지 않는다.
 * 여기 없는 409 는 목록에 없던 새 코드까지 모두 남긴다.
 */
export const WORKER_RESOLVABLE_REJECTIONS: ReadonlySet<string> = new Set([
  // 같은 키의 앞 요청이 남긴 것이 있을 수 있다 — 거절이 아니라 아직 모르는 상태다.
  'FULFILLMENT_COMMAND_IN_PROGRESS',
  'FULFILLMENT_IDEMPOTENCY_MISMATCH',
  // 잘못 집었거나 잘못 고른 것
  'SIMPLE_OUTBOUND_BARCODE_UNKNOWN',
  'SIMPLE_OUTBOUND_SKU_NOT_IN_SHIPMENT',
  'SIMPLE_OUTBOUND_OVERSCAN',
  'LOCATION_OUTBOUND_SOURCE_MISMATCH',
  'LOCATION_OUTBOUND_OVERSCAN',
  'LOCATION_OUTBOUND_WAREHOUSE_MISMATCH',
  'LOCATION_OUTBOUND_PROGRESS_CHANGED',
  'LOCATION_OUTBOUND_FORCE_NOT_APPLIED',
  // 그사이 바뀌었으니 한 번 더
  'PICKING_COMPONENT_CHANGED_RETRY',
  'WORK_ITEM_STALE_LEASE_VERSION',
  'SHIPMENT_WORK_ITEM_CHANGED',
  'SHIPMENT_SESSION_CHANGED',
  'FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY',
  // 작업자가 할 다음 동작이 정해져 있다
  'WORKER_ACTIVE_CLAIM_EXISTS',
  'SHIPMENT_WITHDRAWN',
  'LABEL_REPRINT_REQUIRED',
]);

/** 배치 작업 시작 전 — 물류앱 F2 에서 작업 시작을 누르면 된다. */
const WORKER_RESOLVABLE_PREPARATION_REASONS: ReadonlySet<string> = new Set(['BATCH_NOT_STARTED']);

const WAYBILL_STATE = '송장이 출고할 수 있는 상태가 아니라 반영하지 못했어요. 송장 상태를 확인해 주세요.';
const WORK_RECORD = '이 상자의 배치 작업 기록을 찾지 못해 반영하지 못했어요. 상자가 어느 배치에 있는지 확인해 주세요.';
const INSPECTION = '검수 기록이 맞지 않아 반영하지 못했어요. 상자를 열어 담긴 상품과 기록을 확인해 주세요.';
const STOCK_RECORD = '출고 수량과 재고 기록이 맞지 않아 출고하지 못했어요. 상자의 피킹·검수 기록을 확인해 주세요.';
const SESSION = '배치 재고 기록이 진행 중이 아니라 반영하지 못했어요. 배치 상태를 확인해 주세요.';
const HANDOFF = '다른 작업자가 맡은 상자라 반영하지 못했어요. 담당을 넘기거나 풀어 주세요.';

const REASONS: Record<string, ScanRejectionReason> = {
  SHIPMENT_TOTE_NOT_RELEASED: {
    message: '바구니 배정이 남아 있어 출고하지 못했어요. 바구니 배정을 풀면 작업자가 다시 찍을 수 있어요.',
    action: 'release_tote',
  },
  SHIPMENT_INVOICE_NOT_READY: { message: WAYBILL_STATE, action: 'check_waybill' },
  WAYBILL_NOT_DISPATCHABLE: { message: WAYBILL_STATE, action: 'check_waybill' },
  WAYBILL_LABEL_UNAVAILABLE: { message: WAYBILL_STATE, action: 'check_waybill' },
  WAYBILL_LABEL_NOT_ALLOCATED: { message: WAYBILL_STATE, action: 'check_waybill' },
  WAYBILL_STALE: {
    message: '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 송장을 다시 발급해 주세요.',
    action: 'check_waybill',
  },
  WORK_ITEM_HANDOFF_REQUIRED: { message: HANDOFF, action: 'handoff_worker' },
  SIMPLE_OUTBOUND_CLAIMED_BY_OTHER: { message: HANDOFF, action: 'handoff_worker' },
  SHIPMENT_PACKER_LEASE_REQUIRED: {
    message: '이 상자를 포장할 작업자 확인이 맞지 않아 반영하지 못했어요. 포장 담당을 확인해 주세요.',
    action: 'handoff_worker',
  },
  SHIPMENT_NOT_DISPATCHABLE: {
    message: '지금 출고할 수 없는 상자예요. 주문이 취소되거나 바뀌었는지 확인해 주세요.',
    action: 'review_box',
  },
  SHIPMENT_NOT_INSPECTION_READY: {
    message: '아직 검수할 수 없는 단계의 상자라 반영하지 못했어요. 상자의 작업 단계를 확인해 주세요.',
    action: 'review_box',
  },
  SIMPLE_OUTBOUND_METHOD_UNSUPPORTED: {
    message: '개별 피킹 배치가 아니라 물류앱에서 처리할 수 없는 상자예요. 배치의 피킹 방식을 확인해 주세요.',
    action: 'review_box',
  },
  SIMPLE_OUTBOUND_WORK_ITEM_MISSING: { message: WORK_RECORD, action: 'review_box' },
  SHIPMENT_WORK_ITEM_MISSING: { message: WORK_RECORD, action: 'review_box' },
  WORK_ITEM_NOT_CLAIMABLE: { message: WORK_RECORD, action: 'review_box' },
  SHIPMENT_SESSION_MISSING: { message: SESSION, action: 'review_box' },
  SHIPMENT_SESSION_NOT_ACTIVE: { message: SESSION, action: 'review_box' },
  PICKING_SESSION_NOT_ACTIVE: { message: SESSION, action: 'review_box' },
  SHIPMENT_INSPECTION_LINE_UNKNOWN: { message: INSPECTION, action: 'review_box' },
  SHIPMENT_LINE_OVER_INSPECTED: { message: INSPECTION, action: 'review_box' },
  SHIPMENT_INSPECTION_INCOMPLETE: { message: INSPECTION, action: 'review_box' },
  SHIPMENT_INSPECTION_CUSTODY_SHORT: { message: INSPECTION, action: 'review_box' },
  SHIPMENT_DISPATCH_ALLOCATION_MISMATCH: { message: STOCK_RECORD, action: 'review_box' },
  SHIPMENT_DISPATCH_CUSTODY_MISMATCH: { message: STOCK_RECORD, action: 'review_box' },
  SIMPLE_OUTBOUND_PLAN_INVALIDATED: {
    message: '출고 대상이나 작업 상태가 바뀌어 반영하지 못했어요. 배치와 상자 상태를 확인해 주세요.',
    action: 'review_box',
  },
};

/**
 * 출고 저장이 송장을 받아 주는 검사(발송할 수 있는 송장 한 장 · 상자 구성·받는 분과 일치)에서 난 거절.
 * 이 검사를 통과하는 새 송장이 나오면 풀린다. 라벨 할당·출력 쪽 거절은 송장을 새로 받아도 그대로다.
 */
export const REJECTIONS_RESOLVED_BY_NEW_WAYBILL: ReadonlySet<string> = new Set([
  'SHIPMENT_INVOICE_NOT_READY',
  'WAYBILL_NOT_DISPATCHABLE',
  'WAYBILL_STALE',
]);

export function scanRejectionReason(code: string): ScanRejectionReason {
  return (
    REASONS[code] ?? {
      message: `물류앱의 출고 저장이 반영되지 않았어요(${code}). 상자 상태를 확인해 주세요.`,
      action: 'review_box',
    }
  );
}

export interface RecordableRejection {
  code: string;
  reasonCode: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 출고 저장 경로가 던진 예외 중 관리자 화면에 남길 거절. 409 가 아니거나 작업자가 풀 거절이면 null.
 * 코드는 응답 필터와 같은 순서(`code` → `error`)로 읽는다.
 */
export function recordableRejection(error: unknown): RecordableRejection | null {
  let code: string;
  let reasonCode: string | null = null;
  if (error instanceof HttpException) {
    if (error.getStatus() !== Number(HttpStatus.CONFLICT)) return null;
    const body = error.getResponse();
    const found = isRecord(body) ? (body.code ?? body.error) : undefined;
    code = typeof found === 'string' && found !== 'Conflict' ? found : 'CONFLICT';
    const details = isRecord(body) && isRecord(body.details) ? body.details : undefined;
    if (typeof details?.reasonCode === 'string') reasonCode = details.reasonCode;
  } else if (error instanceof ConflictError) {
    code = /^([A-Z][A-Z_]+):/.exec(error.message)?.[1] ?? 'CONFLICT';
  } else {
    return null;
  }
  if (WORKER_RESOLVABLE_REJECTIONS.has(code)) return null;
  if (reasonCode && WORKER_RESOLVABLE_PREPARATION_REASONS.has(reasonCode)) return null;
  return { code, reasonCode };
}
