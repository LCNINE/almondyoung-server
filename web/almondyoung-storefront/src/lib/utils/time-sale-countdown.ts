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

const pad = (value: number) => String(value).padStart(2, "0")

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
