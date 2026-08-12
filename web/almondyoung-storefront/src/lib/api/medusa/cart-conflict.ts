/**
 * 같은 카트를 두 요청이 동시에 고칠 때 Medusa 가 내는 에러를 가려낸다.
 *
 * Medusa 의 카트 워크플로는 카트 id 로 락을 잡지만 TTL 이 10초로 고정이고 연장되지 않는다.
 * 응답이 느려져 워크플로가 10초를 넘기면 락이 만료돼 상호배제가 풀리고, 그 사이 다른 요청이
 * 배송수단 행을 지우면 먼저 뜬 스냅샷이 사라진 id 를 붙들어 터진다. 락을 아예 못 잡는 쪽
 * (2초 대기 후 포기)도 같은 경합의 다른 얼굴이다.
 *
 * 둘 다 카트 상태가 잘못된 게 아니라 타이밍 문제라서, 다시 읽고 한 번 더 시도하면 풀린다.
 *
 * 판정은 상태 코드를 먼저 본다. Medusa 의 에러 핸들러는 MedusaError 가 아닌 예외의 메시지를
 * "An unknown error occurred." 로 통째로 갈아버려서, 락 실패처럼 평범한 Error 로 던져지는
 * 경우엔 원문이 클라이언트까지 오지 않는다. 문구 매칭만으로는 잡을 수 없다.
 */

/** Medusa 가 경합을 conflict 로 알려줄 때. 재시도해도 된다고 스펙이 보장하는 자리다. */
const CONFLICT_STATUS = 409

/**
 * 락이 풀린 사이 다른 요청이 배송수단을 갈아치워 사라진 id 를 참조한 경우. 이건 MedusaError
 * (NOT_FOUND) 라 원문이 그대로 온다. 실제 문구는 `ShippingMethod with id: casm_x was not found`
 * 처럼 id 뒤에 콜론이 붙는다.
 */
const STALE_SHIPPING_METHOD_PATTERN =
  /shipping ?method with id[:\s].*not found/i

/** 락 자체를 못 잡은 경우. Medusa 가 메시지를 갈지 않고 넘겨줄 때만 잡힌다. */
const LOCK_PATTERN = /failed to acquire lock/i

const readStatus = (error: unknown): number | undefined => {
  const status = (error as { status?: unknown })?.status
  return typeof status === "number" ? status : undefined
}

const readMessage = (error: unknown): string =>
  typeof error === "string"
    ? error
    : ((error as { message?: string })?.message ?? "")

export function isTransientCartConflictError(error: unknown): boolean {
  if (readStatus(error) === CONFLICT_STATUS) {
    return true
  }

  const message = readMessage(error)
  return (
    LOCK_PATTERN.test(message) || STALE_SHIPPING_METHOD_PATTERN.test(message)
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
