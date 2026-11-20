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
  SHIPMENT_HANDED_OVER_TO_SELLMATE:
    '셀메이트가 내보내는 주문의 상자예요. 이 상자는 두고 넘어가 주세요.',
  SHIPMENT_NOT_FULLY_RESERVED: UNDER_RESERVED_MESSAGE,
  SHIPMENT_NOT_FULLY_RESERVED_PHYSICAL: UNDER_RESERVED_MESSAGE,
  BATCH_START_BLOCKED: '시작하지 못했어요.',
  BATCH_JOIN_BLOCKED: '넣지 못했어요.',
  BATCH_NOT_JOINABLE:
    '이 배치에는 더 넣을 수 없어요(끝났거나 멈춘 배치). 다른 배치를 골라 주세요.',
  OUTBOUND_BATCH_STARTED_RETRY:
    '방금 작업이 시작된 배치예요. 다시 넣어 주세요.',
  PICKING_BATCH_EMPTY:
    '배치에 박스가 없어서 시작할 수 없어요. 배치 상세에서 박스를 먼저 넣어 주세요.',
  PICKING_BATCH_NOT_STARTED: '피킹 화면에서 「피킹 시작」을 먼저 눌러 주세요.',
  PICKING_SESSION_NOT_ACTIVE:
    '배치 재고 작업이 진행 가능한 상태가 아니에요. 배치 상세에서 재고 작업 상태를 확인해 주세요.',
  SHIPMENT_WITHDRAWN: '배치에서 빠졌거나 빠지는 중인 박스예요. 창고 담당자에게 해당 송장을 사용하지 않도록 알려 주세요.',
  SHIPMENT_ALREADY_WITHDRAWING:
    '이미 빼는 중인 박스예요. 창고 담당자에게 뺄 상품의 되돌림 처리를 요청해 주세요.',
  TOTE_BARCODE_RESERVED:
    '되돌림 바구니용 바코드는 토트로 등록할 수 없어요. 다른 바코드를 사용해 주세요.',
  LABEL_REPRINT_REQUIRED:
    '송장이 바뀌었거나 아직 출력하지 않았어요. 창고 담당자에게 프린터가 있는 창고 앱에서 송장을 출력하도록 요청해 주세요.',
  WAYBILL_LABEL_NOT_ALLOCATED:
    '작업이 시작되지 않은 박스예요. 피킹 화면에서 「피킹 시작」을 먼저 눌러 주세요.',
  WAYBILL_STALE:
    '주문(주소·상품)이 바뀌어 이 송장은 쓸 수 없어요. 출고 상세에서 송장 상태를 확인해 주세요. 재발급이 가능한 상태라면 재발급해 주세요.',
  WAYBILL_NOT_DISPATCHABLE:
    '한진 등록이 끝나지 않은 송장이에요. 출고 상세에서 운송장 발급 상태를 확인해 주세요.',
  SIMPLE_OUTBOUND_PLAN_INVALIDATED:
    '출고 준비를 진행할 수 없어요. 배치와 송장 상태를 확인해 주세요.',
  SHORT_PICK_EXCEEDS_UNPICKED:
    '아직 집지 않은 수량보다 많이 결품 보고할 수 없어요. 해당 로케이션의 남은 수량을 확인해 주세요.',
  SHORT_PICK_WORK_ITEM_WAITING:
    '이 박스는 지금 결품을 보고할 수 없어요. 창고 담당자에게 송장을 다시 스캔하도록 요청해 주세요.',
  SHORT_PICK_INVOICE_NOT_VOIDABLE:
    '송장을 지금 무효화할 수 없어 결품을 보고하지 못했어요. 출고 상세에서 송장 상태를 확인해 주세요.',
  SHIPMENT_RECOVERY_IN_PROGRESS:
    '같은 상자의 다른 취소를 처리하고 있어요. 상자가 출고 배치에 있으면 먼저 빼고, 1~2분 뒤 다시 시도해 주세요.',
  SHIPMENT_ALREADY_DISPATCHED:
    '이미 출고된 상자예요. 취소 대신 회수나 반품으로 처리해 주세요.',
  SHIPMENT_NOT_ACTIVE: '이미 취소됐거나 쓰지 않는 상자예요.',
  SHIPMENT_LINE_STALE_VERSION:
    '그사이 주문이 바뀌었어요. 새로고침한 뒤 다시 시도해 주세요.',
};

const PREPARATION_REASON_MESSAGES: Record<string, { recovery: 'retry_preparation' | 'review_batch'; message: string }> = {
  BATCH_NOT_STARTED: {
    recovery: 'retry_preparation',
    message: '피킹 화면에서 「피킹 시작」을 먼저 눌러 주세요.',
  },
  SOURCE_INSUFFICIENT: {
    recovery: 'retry_preparation',
    message: '출고할 재고가 부족해요. 재고를 확인한 뒤 다시 준비해 주세요.',
  },
  REPLAN_LIMIT_REACHED: {
    recovery: 'retry_preparation',
    message: '출고 준비의 자동 재시도 한도에 도달했어요. 재고를 확인한 뒤 다시 준비해 주세요.',
  },
  SOURCE_STOCK_CHANGED: {
    recovery: 'review_batch',
    message: '출고에 사용할 재고 상태가 바뀌었어요. 배치와 재고 상태를 확인해 주세요.',
  },
  PLAN_IDENTITY_CHANGED: {
    recovery: 'review_batch',
    message: '출고 계획이 바뀌었어요. 배치와 송장 상태를 확인해 주세요.',
  },
  PLAN_NOT_DRAFT: {
    recovery: 'review_batch',
    message: '현재 출고 계획은 초안 상태가 아니에요. 배치의 진행 상태를 확인해 주세요.',
  },
  SHIPMENT_SNAPSHOT_CHANGED: {
    recovery: 'review_batch',
    message: '박스의 출고 정보가 바뀌었어요. 주문과 송장 상태를 확인해 주세요.',
  },
  ALLOCATION_INVALID: {
    recovery: 'review_batch',
    message: '출고 재고 배정이 유효하지 않아요. 배치와 재고 배정 상태를 확인해 주세요.',
  },
  ELIGIBILITY_CHANGED: {
    recovery: 'review_batch',
    message: '박스의 출고 가능 상태가 바뀌었어요. 주문과 배치 상태를 확인해 주세요.',
  },
  ACTIVE_WORK_REQUIRES_REVIEW: {
    recovery: 'review_batch',
    message: '배치의 진행 중인 재고 작업을 확인할 수 없어요. 배치 상세에서 재고 작업 상태를 확인해 주세요.',
  },
};

/** 화면에 따로 문장을 둔 거절 코드면 그 문장 */
export function knownConflictMessage(code: string | null): string | undefined {
  return code ? CONFLICT_MESSAGES[code] : undefined;
}

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
    Object.hasOwn(PREPARATION_REASON_MESSAGES, reasonCode)
  ) {
    const guidance = PREPARATION_REASON_MESSAGES[reasonCode];

    if (recovery === guidance.recovery) return guidance.message;
  }

  if (parsed.code === 'BATCH_START_BLOCKED' || parsed.code === 'BATCH_JOIN_BLOCKED') {
    return batchBlockedToastMessage(parsed);
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
      '창고 담당자에게 적치 완료를 요청한 뒤 다시 「피킹 시작」을 누르거나, 배치 상세에서 이 박스를 빼고 시작하세요.',
    join: '창고 담당자에게 적치 완료를 요청한 뒤 다시 넣어 주세요.',
  },
  STOCK_SHORT: {
    title: '재고 부족',
    start: '배치 상세에서 이 박스를 빼고 시작하세요.',
    join: '재고가 모자라 이 배치에 넣을 수 없어요. 재고를 확인해 주세요.',
  },
  WAYBILL_NOT_READY: {
    title: '송장 미발급·재발급 필요',
    start:
      '출고 상세에서 송장 상태를 확인하고 발급(재발급)한 뒤 다시 시작하거나, 배치 상세에서 이 박스를 빼고 시작하세요.',
    join: '출고 상세에서 송장 상태를 확인하고 발급(재발급)한 뒤 다시 넣어 주세요.',
  },
};

const text = (value: unknown) =>
  typeof value === 'string' && value ? value : null;
const quantity = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : '?';

function blockerOrderNos(blocker: Record<string, unknown>): string {
  const orderNos = Array.isArray(blocker.orderNos)
    ? blocker.orderNos.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  return orderNos.length ? `주문번호 ${orderNos.join(', ')}` : '주문번호 확인 필요';
}

const INCOMPLETE_BLOCKER_MESSAGE = '일부 박스의 상세 사유를 확인하지 못했어요. 배치와 해당 박스의 출고 상태를 확인해 주세요.';

function batchBlockedToastMessage(error: ParsedServerError): string {
  const joining = error.code === 'BATCH_JOIN_BLOCKED';
  const lines = [joining ? '박스를 배치에 추가하지 못했어요.' : '배치를 시작하지 못했어요.'];
  const entries = Array.isArray(error.errors) ? error.errors : null;
  const guidance = new Set<string>();
  let readableCount = 0;

  if (entries) {
    lines.push(`차단 항목 ${entries.length}건`);
    for (const entry of entries) {
      const blocker = record(entry);
      if (!blocker) continue;

      const reason = text(blocker.reason);
      const wording = reason && Object.hasOwn(BATCH_BLOCKER_TEXT, reason)
        ? BATCH_BLOCKER_TEXT[reason as keyof typeof BATCH_BLOCKER_TEXT]
        : null;
      const shipmentId = text(blocker.shipmentId);
      const trackingNo = text(blocker.trackingNo);
      const skuName = text(blocker.skuName);
      const skuCode = text(blocker.skuCode);
      const row = [blockerOrderNos(blocker)];

      if (trackingNo) row.push(`송장 ${trackingNo}`);
      if (skuName || skuCode)
        row.push(`상품 ${skuName ?? skuCode}${skuName && skuCode ? ` (${skuCode})` : ''}`);
      if (blocker.requiredQty != null || blocker.shortQty != null)
        row.push(`${quantity(blocker.requiredQty)}개 중 ${quantity(blocker.shortQty)}개 부족`);
      row.push(`사유: ${wording?.title ?? reason ?? '확인 필요'}`);
      lines.push(row.join(' · '));
      if (wording) guidance.add(joining ? wording.join : wording.start);
      if (shipmentId && reason) readableCount++;
    }
  }

  lines.push(...guidance);
  if (!entries || readableCount === 0 || readableCount !== entries.length) {
    lines.push(INCOMPLETE_BLOCKER_MESSAGE);
    lines.push(`서버 상세: ${error.message}`);
  }
  return lines.join('\n');
}

function batchBlockerRow(blocker: Record<string, unknown>): string {
  const trackingNo = text(blocker.trackingNo);
  const orderLabel = blockerOrderNos(blocker);
  const tracking = trackingNo
    ? ` · 송장 ${trackingNo.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3')}`
    : '';

  if (blocker.reason === 'WAYBILL_NOT_READY')
    return `${orderLabel}${tracking} · 송장 재발급 필요`;

  return `${orderLabel}${tracking} · ${text(blocker.skuName) ?? text(blocker.skuCode) ?? '상품'} ${quantity(blocker.requiredQty)}개 중 ${quantity(blocker.shortQty)}개 부족`;
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
