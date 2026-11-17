export interface ParsedServerError {
  status: number | null;
  code: string | null;
  message: string;
  denied: boolean;
  conflict: boolean;
  /** 응답 본문의 details 원본 — 모양 검증은 쓰는 쪽 몫이다. 없으면 undefined */
  details: unknown;
  errors: unknown;
}

type ErrorLike = {
  message?: unknown;
  statusCode?: unknown;
  response?: unknown;
};

/** 객체 검사 직후 좁히기 — 응답 본문을 읽는 쪽이 같은 헬퍼를 쓰게 내보낸다 */
export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeMessage(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) {
    const messages = value.filter(
      (item): item is string =>
        typeof item === 'string' && item.trim().length > 0
    );
    return messages.length ? messages.join(', ') : null;
  }
  return null;
}

/** Supports both raw AxiosError and the app's normalized CustomError. */
export function parseServerError(
  error: unknown,
  fallback = '요청 처리 중 오류가 발생했습니다.'
): ParsedServerError {
  const root = record(error) as ErrorLike | null;
  const response = record(root?.response);
  const responseData = record(response?.data) ?? response;
  const statusCandidate = response?.status ?? root?.statusCode;
  const status = typeof statusCandidate === 'number' ? statusCandidate : null;
  const codeCandidate = responseData?.code ?? responseData?.errorCode;
  const code = typeof codeCandidate === 'string' ? codeCandidate : null;
  const message =
    normalizeMessage(responseData?.message) ??
    normalizeMessage(root?.message) ??
    fallback;

  return {
    status,
    code,
    message,
    denied: status === 403,
    conflict: status === 409,
    details: responseData?.details,
    errors: responseData?.errors,
  };
}

const UNDER_RESERVED_MESSAGE =
  '재고가 부족해 예약되지 않은 상품이 있어요. 입고하거나 재고를 조정하면 자동으로 예약돼요.';

export const CONFLICT_MESSAGES: Record<string, string> = {
  SHIPMENT_NOT_FULLY_RESERVED: UNDER_RESERVED_MESSAGE,
  SHIPMENT_NOT_FULLY_RESERVED_PHYSICAL: UNDER_RESERVED_MESSAGE,
  BATCH_START_BLOCKED: '시작하지 못했어요.',
  BATCH_JOIN_BLOCKED: '넣지 못했어요.',
  BATCH_NOT_JOINABLE:
    '이 배치에는 더 넣을 수 없어요(끝났거나 멈춘 배치). 다른 배치를 골라 주세요.',
  OUTBOUND_BATCH_STARTED_RETRY:
    '방금 작업이 시작된 배치예요. 다시 넣어 주세요.',
  PICKING_BATCH_EMPTY:
    '배치에 박스가 없어서 시작할 수 없어요. 관리자 화면에서 박스를 먼저 넣어 주세요.',
  PICKING_BATCH_NOT_STARTED: '배치 화면에서 「피킹 시작」을 먼저 눌러 주세요.',
  PICKING_SESSION_NOT_ACTIVE:
    '배치 재고 기록을 확인해야 해요. 관리자에게 문의해 주세요.',
  SHIPMENT_WITHDRAWN: '빠진 박스예요. 송장은 버려 주세요.',
  SHIPMENT_ALREADY_WITHDRAWING:
    '이미 빼는 중인 박스예요. 송장을 스캔해 뺄 상품을 되돌림 바구니에 넣어 주세요.',
  TOTE_BARCODE_RESERVED:
    '되돌림 바구니용 바코드는 토트로 등록할 수 없어요. 다른 바코드를 사용해 주세요.',
  LABEL_REPRINT_REQUIRED:
    '송장이 바뀌었거나 아직 출력하지 않았어요. 프린터가 있는 창고 앱에서 송장을 출력한 뒤 계속해 주세요.',
  WAYBILL_LABEL_NOT_ALLOCATED:
    '작업이 시작되지 않은 박스예요. 배치 화면에서 「피킹 시작」을 먼저 눌러 주세요.',
  WAYBILL_STALE:
    '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 관리자에게 재발급을 요청해 주세요.',
  WAYBILL_NOT_DISPATCHABLE:
    '한진 등록이 끝나지 않은 송장이에요. 관리자에게 운송장 발급 상태를 확인해 달라고 해 주세요.',
  SIMPLE_OUTBOUND_PLAN_INVALIDATED:
    '출고 계획이 바뀌었어요. 송장을 다시 확인해 주세요.',
  SHORT_PICK_EXCEEDS_UNPICKED:
    '아직 집지 않은 수량보다 많이 결품 보고할 수 없어요. 해당 로케이션의 남은 수량을 확인해 주세요.',
  SHORT_PICK_WORK_ITEM_WAITING:
    '이 박스는 지금 결품을 보고할 수 없어요. 송장을 다시 찍어 주세요.',
  SHORT_PICK_INVOICE_NOT_VOIDABLE:
    '송장을 지금 처리할 수 없어 결품을 보고하지 못했어요. 관리자에게 문의해 주세요.',
};

const PREPARATION_REASON_CODES: readonly string[] = [
  'SOURCE_STOCK_CHANGED',
  'PLAN_IDENTITY_CHANGED',
  'PLAN_NOT_DRAFT',
  'SHIPMENT_SNAPSHOT_CHANGED',
  'ALLOCATION_INVALID',
  'ELIGIBILITY_CHANGED',
  'SOURCE_INSUFFICIENT',
  'ACTIVE_WORK_REQUIRES_REVIEW',
  'REPLAN_LIMIT_REACHED',
  'BATCH_NOT_STARTED',
];

export function getServerDenyMessage(
  error: unknown,
  fallback = '작업에 실패했습니다.'
): string {
  const parsed = parseServerError(error, fallback);
  const details = record(parsed.details);
  const reasonCode = details?.reasonCode;
  const recovery = details?.recovery;

  if (
    parsed.code === 'SIMPLE_OUTBOUND_PLAN_INVALIDATED' &&
    !Array.isArray(parsed.details) &&
    typeof reasonCode === 'string' &&
    PREPARATION_REASON_CODES.includes(reasonCode) &&
    (recovery === 'retry_preparation' || recovery === 'review_batch')
  ) {
    if (reasonCode === 'BATCH_NOT_STARTED')
      return '배치 화면에서 「피킹 시작」을 먼저 눌러 주세요.';

    if (recovery === 'review_batch')
      return '출고 대상이나 작업 상태가 바뀌었어요. 배치와 송장을 확인해 주세요.';

    if (reasonCode === 'SOURCE_INSUFFICIENT')
      return '출고할 재고가 부족해요. 재고를 확인한 뒤 다시 준비해 주세요.';

    return '재고가 변경됐어요. 현재 재고를 확인한 뒤 다시 준비해 주세요.';
  }

  const known = parsed.code ? CONFLICT_MESSAGES[parsed.code] : undefined;

  if (known) return known;

  if (parsed.denied) {
    return `권한이 없어 서버가 작업을 거부했습니다. ${parsed.message}`;
  }
  if (parsed.conflict) {
    return `다른 작업으로 상태가 변경되어 서버가 작업을 거부했습니다. ${parsed.message}`;
  }
  return parsed.message;
}

const BATCH_BLOCKER_TEXT = {
  INBOUND_PENDING: {
    title: '적치 대기 중인 상품',
    start:
      '적치를 끝낸 뒤 다시 「피킹 시작」을 누르거나, 관리자 화면에서 이 박스를 배치에서 빼고 시작하세요.',
    join: '적치를 끝낸 뒤 다시 넣어 주세요.',
  },
  STOCK_SHORT: {
    title: '재고 부족',
    start: '관리자 화면에서 이 박스를 배치에서 빼고 시작하세요.',
    join: '재고가 모자라 이 배치에 넣을 수 없어요. 관리자에게 문의해 주세요.',
  },
  WAYBILL_NOT_READY: {
    title: '송장 미발급·재발급 필요',
    start:
      '송장을 발급(재발급)한 뒤 다시 시작하거나, 관리자 화면에서 이 박스를 배치에서 빼고 시작하세요.',
    join: '관리자에게 송장 재발급을 요청한 뒤 다시 넣어 주세요.',
  },
  CANCEL_REQUESTED: {
    title: '취소 처리 중인 주문',
    start:
      '취소 처리가 끝날 때까지 이 박스는 출고할 수 없어요. 관리자 화면에서 이 박스를 배치에서 빼고 시작하세요.',
    join: '취소가 끝날 때까지 이 박스는 넣을 수 없어요.',
  },
};

const text = (value: unknown) =>
  typeof value === 'string' && value ? value : null;
const quantity = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : '?';

function batchBlockerRow(blocker: Record<string, unknown>): string {
  const trackingNo = text(blocker.trackingNo);
  const tracking = trackingNo
    ? trackingNo.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3')
    : `박스 ${String(blocker.shipmentId).slice(0, 8)}`;

  if (blocker.reason === 'WAYBILL_NOT_READY')
    return `${tracking} · 송장 재발급 필요`;
  if (blocker.reason === 'CANCEL_REQUESTED')
    return `${tracking} · 취소 처리 중`;

  return `${tracking} · ${text(blocker.skuName) ?? text(blocker.skuCode) ?? '상품'} ${quantity(blocker.requiredQty)}개 중 ${quantity(blocker.shortQty)}개 부족`;
}

export function getBatchBlockerGroups(error: ParsedServerError) {
  const joining = error.code === 'BATCH_JOIN_BLOCKED';
  const entries = Array.isArray(error.errors) ? error.errors : [];
  const blockers = entries
    .map(record)
    .filter(
      (entry): entry is Record<string, unknown> =>
        entry !== null &&
        typeof entry.shipmentId === 'string' &&
        typeof entry.reason === 'string' &&
        Object.hasOwn(BATCH_BLOCKER_TEXT, entry.reason)
    );
  const incomplete =
    blockers.length === 0 || blockers.length !== entries.length;

  const groups = Object.entries(BATCH_BLOCKER_TEXT).flatMap(
    ([reason, wording]) => {
      const rows = blockers
        .filter((blocker) => blocker.reason === reason)
        .map(batchBlockerRow);

      return rows.length
        ? [
            {
              reason,
              title:
                joining && reason === 'WAYBILL_NOT_READY'
                  ? '송장 재발급 필요'
                  : wording.title,
              guidance: joining ? wording.join : wording.start,
              rows,
            },
          ]
        : [];
    }
  );

  return { groups, incomplete };
}
