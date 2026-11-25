const FALLBACK = '예약 해제에 실패했습니다.';

/**
 * 409 의 문구는 서버가 현장 말로 정한 것이라 그대로 보여 준다.
 * 다른 상태의 문구는 보장되지 않으므로 고정 문구로 갈음한다.
 */
export function releaseErrorText(error: unknown): string {
  if (
    error instanceof Error &&
    (error as { statusCode?: unknown }).statusCode === 409 &&
    error.message
  ) {
    return error.message;
  }
  return FALLBACK;
}
