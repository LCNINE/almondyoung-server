/** 이 시간 이하로 남으면 초 단위 카운트다운으로 바꾼다. 그 위로는 "N일" 로만 보여준다. */
export const COUNTDOWN_THRESHOLD_MS = 24 * 60 * 60 * 1000

export type CountdownView =
  | { kind: "days"; days: number }
  | { kind: "clock"; hours: number; minutes: number; seconds: number }
  | { kind: "ended" }

/**
 * 남은 시간 표시.
 *
 * 일수는 **내림**이다. 6일 3시간이 "7일" 로 뜨면 다음 날 아침에 "5일" 로 이틀 뛴 것처럼 보인다.
 * 내림이면 매일 정확히 하루씩 줄어든다.
 */
export function resolveCountdown(endsAt: string, now: number): CountdownView {
  const remaining = Date.parse(endsAt) - now

  if (!Number.isFinite(remaining) || remaining <= 0) return { kind: "ended" }

  if (remaining > COUNTDOWN_THRESHOLD_MS) {
    return { kind: "days", days: Math.floor(remaining / (24 * 60 * 60 * 1000)) }
  }

  const totalSeconds = Math.floor(remaining / 1000)
  return {
    kind: "clock",
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  }
}

/** 이 시간 이하로 남으면 마감 임박이다 — 타이머를 붉게 바꿔 시선을 끈다. */
export const URGENT_THRESHOLD_MS = 60 * 60 * 1000

/**
 * 종료 후 캐시가 비워졌다고 볼 수 있는 시점.
 *
 * 세일가 캐시를 비우는 건 Medusa 의 `time-sale-cache-boundary` 크론이다 (60초 주기, 경계 창 70초
 * — `apps/medusa/src/jobs/time-sale-cache-boundary.ts`). 카운트다운이 0 이 된 순간엔 크론이 아직
 * 안 돌았을 수 있어, 그때 받은 화면은 캐시된 세일가 그대로다. 크론 주기 + 창을 넘겨 한 번 더 받는다.
 */
export const CACHE_SETTLE_MS = 75 * 1000

/**
 * 종료 후 화면을 다시 받을 두 시점.
 *
 * 첫 번째는 크론이 이미 돌았을 때를 위한 즉시 갱신, 두 번째는 크론을 기다린 확실한 갱신이다.
 * 둘 다 흩뿌린다 — 손님 전원이 같은 초에 0 을 맞으므로, 크론이 막 캐시를 비운 직후 한꺼번에
 * 받으러 오면 미스가 전부 Medusa 로 몰린다.
 */
export function refreshDelaysAfterEnd(random: () => number = Math.random): [number, number] {
  return [Math.round(random() * 5000), CACHE_SETTLE_MS + Math.round(random() * 30000)]
}

/**
 * 종료 후 갱신 예약. **취소 수단을 일부러 두지 않는다.**
 *
 * 컴포넌트 effect 에 묶으면 첫 갱신이 후속 갱신을 죽인다 — 세일 목록 캐시(60초)는 크론과
 * 무관하게 자연 만료돼 첫 갱신이 "세일 없음" 을 받고, 섹션이 사라지며 언마운트 cleanup 이
 * 두 번째 타이머를 지운다. 그런데 상품 가격 캐시(3600초)는 크론 전이라 다른 섹션 카드에
 * 세일가가 남는다. 그래서 컴포넌트 수명과 떼어 모듈에서 들고 있는다.
 *
 * 같은 마감은 한 번만 예약한다 — 홈 섹션·상품 상세가 같은 세일을 동시에 들고 있다.
 */
export function createEndRefreshScheduler(
  schedule: (run: () => void, ms: number) => unknown = setTimeout,
  delays: () => number[] = refreshDelaysAfterEnd
) {
  const scheduled = new Set<string>()
  return (endsAt: string, refresh: () => void) => {
    if (scheduled.has(endsAt)) return
    scheduled.add(endsAt)
    for (const delay of delays()) schedule(refresh, delay)
  }
}

export const scheduleRefreshAfterEnd = createEndRefreshScheduler()

export type SectionCountdown = {
  days: number
  hours: number
  minutes: number
  seconds: number
  /** 초 단위까지 붙인 남은 시간. 0 이면 종료다. */
  remainingMs: number
  isUrgent: boolean
}

/**
 * 섹션 헤더용 남은 시간.
 *
 * `resolveCountdown` 과 달리 하루를 넘어도 시:분:초를 함께 준다. 타임세일의 긴박감은 초가
 * 움직이는 데서 나오는데, "2일" 로만 보여주면 이틀 내내 화면이 멈춰 있다.
 */
export function resolveSectionCountdown(
  endsAt: string,
  now: number
): SectionCountdown | null {
  const remaining = Date.parse(endsAt) - now
  if (!Number.isFinite(remaining) || remaining <= 0) return null

  const totalSeconds = Math.floor(remaining / 1000)
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    remainingMs: remaining,
    isUrgent: remaining <= URGENT_THRESHOLD_MS,
  }
}

const pad = (value: number) => String(value).padStart(2, "0")

/** `04:23:11` — 하루 이상 남았으면 일수는 호출부가 따로 보여준다. */
export function formatClock(view: SectionCountdown): string {
  return `${pad(view.hours)}:${pad(view.minutes)}:${pad(view.seconds)}`
}

export function formatCountdown(view: CountdownView): string {
  switch (view.kind) {
    case "days":
      return `${view.days}일`
    case "clock":
      return `${pad(view.hours)}:${pad(view.minutes)}:${pad(view.seconds)}`
    case "ended":
      return "종료"
  }
}

/**
 * 다음 갱신까지 기다릴 밀리초.
 *
 * 며칠 남은 동안 초마다 다시 그릴 이유가 없다 — 임계값을 넘길 때까지 자고, 임계값 안으로
 * 들어오면 1 초 간격으로 바꾼다.
 */
export function nextTickDelayMs(endsAt: string, now: number): number {
  const remaining = Date.parse(endsAt) - now
  if (!Number.isFinite(remaining) || remaining <= 0) return 0
  if (remaining <= COUNTDOWN_THRESHOLD_MS) return 1000
  return Math.min(remaining - COUNTDOWN_THRESHOLD_MS, 60 * 60 * 1000)
}
