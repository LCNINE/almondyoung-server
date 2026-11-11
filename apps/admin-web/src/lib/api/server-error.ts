export interface ParsedServerError {
  status: number | null;
  code: string | null;
  message: string;
  denied: boolean;
  conflict: boolean;
  /** 응답 본문의 details 원본 — 모양 검증은 쓰는 쪽 몫이다. 없으면 undefined */
  details: unknown;
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
  };
}

const UNDER_RESERVED_MESSAGE =
  '재고가 부족해 예약되지 않은 상품이 있어요. 입고하거나 재고를 조정하면 자동으로 예약돼요.';

const CONFLICT_MESSAGES: Record<string, string> = {
  SHIPMENT_NOT_FULLY_RESERVED: UNDER_RESERVED_MESSAGE,
  SHIPMENT_NOT_FULLY_RESERVED_PHYSICAL: UNDER_RESERVED_MESSAGE,
  SHIPMENT_RECOVERY_IN_PROGRESS:
    '같은 상자의 다른 취소를 처리하고 있어요. 상자가 출고 배치에 있으면 먼저 빼고, 1~2분 뒤 다시 시도해 주세요.',
  SHIPMENT_ALREADY_DISPATCHED:
    '이미 출고된 상자예요. 취소 대신 회수나 반품으로 처리해 주세요.',
  SHIPMENT_NOT_ACTIVE: '이미 취소됐거나 쓰지 않는 상자예요.',
  SHIPMENT_LINE_STALE_VERSION:
    '그사이 주문이 바뀌었어요. 새로고침한 뒤 다시 시도해 주세요.',
};

export function getServerDenyMessage(
  error: unknown,
  fallback = '작업에 실패했습니다.'
): string {
  const parsed = parseServerError(error, fallback);
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
