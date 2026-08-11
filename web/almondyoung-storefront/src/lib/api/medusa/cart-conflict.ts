/**
 * 같은 카트를 두 요청이 동시에 고칠 때 Medusa 가 내는 에러를 가려낸다.
 *
 * Medusa 의 카트 워크플로는 카트 id 로 락을 잡지만 TTL 이 10초로 고정이고 연장되지 않는다.
 * 응답이 느려져 워크플로가 10초를 넘기면 락이 만료돼 상호배제가 풀리고, 그 사이 다른 요청이
 * 배송수단 행을 지우면 먼저 뜬 스냅샷이 사라진 id 를 붙들어 터진다. 락을 아예 못 잡는 쪽
 * (2초 대기 후 포기)도 같은 경합의 다른 얼굴이다.
 *
 * 둘 다 카트 상태가 잘못된 게 아니라 타이밍 문제라서, 다시 읽고 한 번 더 시도하면 풀린다.
 */
const TRANSIENT_CART_CONFLICT_PATTERNS = [
  /failed to acquire lock/i,
  /shipping ?method with id .*not found/i,
]

export function isTransientCartConflictError(error: unknown): boolean {
  const message =
    typeof error === "string"
      ? error
      : ((error as { message?: string })?.message ?? "")

  return TRANSIENT_CART_CONFLICT_PATTERNS.some((pattern) =>
    pattern.test(message)
  )
}

/** 경합이 풀릴 시간을 주는 재시도 간격. 락 TTL 보다 훨씬 짧게 둬 렌더를 붙잡지 않는다. */
export const CART_CONFLICT_RETRY_DELAY_MS = 400

/**
 * 카트 쓰기를 경합에 한해 한 번만 다시 시도한다. 그 외 에러는 그대로 던진다.
 *
 * 두 번째도 실패하면 던진다 — 무한 재시도는 이미 느려진 서버를 더 밀어붙일 뿐이다.
 */
export async function withCartConflictRetry<T>(
  run: () => Promise<T>,
  delayMs: number = CART_CONFLICT_RETRY_DELAY_MS
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (!isTransientCartConflictError(error)) throw error
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return run()
  }
}
