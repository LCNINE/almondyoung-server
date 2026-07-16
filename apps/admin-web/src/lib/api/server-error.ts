export interface ParsedServerError {
  status: number | null;
  code: string | null;
  message: string;
  denied: boolean;
  conflict: boolean;
}

type ErrorLike = {
  message?: unknown;
  statusCode?: unknown;
  response?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
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
  };
}

export function getServerDenyMessage(
  error: unknown,
  fallback = '작업에 실패했습니다.'
): string {
  const parsed = parseServerError(error, fallback);
  if (parsed.denied) {
    return `권한이 없어 서버가 작업을 거부했습니다. ${parsed.message}`;
  }
  if (parsed.conflict) {
    return `다른 작업으로 상태가 변경되어 서버가 작업을 거부했습니다. ${parsed.message}`;
  }
  return parsed.message;
}
