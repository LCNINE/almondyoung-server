/**
 * 같은 키로 들어온 반복 작업을 일정 시간 동안 한 번만 통과시킨다.
 *
 * 카트 가격 재계산처럼 "필요할 때만 돌면 되는데 매 렌더마다 불려서 응답을 붙잡는" 작업에 쓴다.
 * 상태를 프로세스 메모리에 두므로 인스턴스가 바뀌면 한 번 더 통과할 뿐이고, 키가 달라지면
 * (예: 멤버십 여부가 바뀌면) 즉시 다시 통과한다.
 */
export type RefreshThrottle = {
  take: (key: string) => boolean
}

export function createRefreshThrottle(
  ttlMs: number,
  now: () => number = Date.now
): RefreshThrottle {
  const lastRunAt = new Map<string, number>()

  return {
    take(key: string): boolean {
      const current = now()

      // 만료된 항목을 걷어 메모리가 계속 불어나지 않게 한다.
      lastRunAt.forEach((at, seen) => {
        if (current - at >= ttlMs) lastRunAt.delete(seen)
      })

      const last = lastRunAt.get(key)
      if (last !== undefined && current - last < ttlMs) return false

      lastRunAt.set(key, current)
      return true
    },
  }
}
