import { describe, expect, it } from "vitest"
import {
  COUNTDOWN_THRESHOLD_MS,
  URGENT_THRESHOLD_MS,
  CACHE_SETTLE_MS,
  createEndRefreshScheduler,
  formatClock,
  refreshDelaysAfterEnd,
  formatCountdown,
  nextTickDelayMs,
  resolveCountdown,
  resolveSectionCountdown,
} from "./time-sale-countdown"

const NOW = Date.parse("2026-08-28T00:00:00.000Z")
const at = (ms: number) => new Date(NOW + ms).toISOString()

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

describe("resolveCountdown", () => {
  // 올림이면 "7일" 로 떠 있다가 다음 날 "5일" 로 이틀 뛴 것처럼 보인다.
  it("하루를 넘으면 일수를 내림해서 보여준다", () => {
    expect(resolveCountdown(at(6 * DAY + 3 * HOUR), NOW)).toEqual({ kind: "days", days: 6 })
  })

  it("24시간 이하면 시:분:초로 바뀐다", () => {
    expect(resolveCountdown(at(23 * HOUR + 14 * 60 * 1000 + 7000), NOW)).toEqual({
      kind: "clock",
      hours: 23,
      minutes: 14,
      seconds: 7,
    })
  })

  it("임계값 정각은 시계 쪽이다", () => {
    expect(resolveCountdown(at(COUNTDOWN_THRESHOLD_MS), NOW).kind).toBe("clock")
    expect(resolveCountdown(at(COUNTDOWN_THRESHOLD_MS + 1), NOW).kind).toBe("days")
  })

  it("지났으면 종료다", () => {
    expect(resolveCountdown(at(0), NOW)).toEqual({ kind: "ended" })
    expect(resolveCountdown(at(-1000), NOW)).toEqual({ kind: "ended" })
  })

  it("날짜가 아니면 종료로 떨어진다", () => {
    expect(resolveCountdown("아무거나", NOW)).toEqual({ kind: "ended" })
  })
})

describe("formatCountdown", () => {
  it("시계는 두 자리로 채워 폭이 안 흔들린다", () => {
    expect(formatCountdown({ kind: "clock", hours: 2, minutes: 3, seconds: 4 })).toBe("02:03:04")
  })

  it("일수와 종료", () => {
    expect(formatCountdown({ kind: "days", days: 6 })).toBe("6일")
    expect(formatCountdown({ kind: "ended" })).toBe("종료")
  })
})

describe("nextTickDelayMs", () => {
  // 며칠 남은 동안 초마다 다시 그릴 이유가 없다.
  it("하루를 넘으면 임계값에 닿을 때까지 잔다 (최대 1시간)", () => {
    expect(nextTickDelayMs(at(6 * DAY), NOW)).toBe(HOUR)
    expect(nextTickDelayMs(at(DAY + 10 * 60 * 1000), NOW)).toBe(10 * 60 * 1000)
  })

  it("24시간 안으로 들어오면 1초 간격", () => {
    expect(nextTickDelayMs(at(3 * HOUR), NOW)).toBe(1000)
  })

  it("끝났으면 더 기다리지 않는다", () => {
    expect(nextTickDelayMs(at(0), NOW)).toBe(0)
  })
})

describe("resolveSectionCountdown", () => {
  // 하루가 넘게 남아도 초가 움직여야 한다. "2일" 로만 두면 이틀 내내 화면이 멈춰 있다.
  it("하루를 넘어도 시:분:초를 함께 준다", () => {
    const view = resolveSectionCountdown(at(2 * DAY + 4 * HOUR + 23 * 60 * 1000 + 11000), NOW)
    expect(view).toMatchObject({ days: 2, hours: 4, minutes: 23, seconds: 11 })
    expect(formatClock(view!)).toBe("04:23:11")
  })

  it("한 시간 이하로 남으면 임박이다", () => {
    expect(resolveSectionCountdown(at(URGENT_THRESHOLD_MS), NOW)?.isUrgent).toBe(true)
    expect(resolveSectionCountdown(at(URGENT_THRESHOLD_MS + 1000), NOW)?.isUrgent).toBe(false)
  })

  it("끝났거나 날짜가 아니면 null 이다", () => {
    expect(resolveSectionCountdown(at(0), NOW)).toBeNull()
    expect(resolveSectionCountdown("not-a-date", NOW)).toBeNull()
  })
})

describe("refreshDelaysAfterEnd", () => {
  // 0 초에 한 번만 받으면 크론이 아직 캐시를 안 비워 세일가가 그대로 남는다. 두 번째는 크론이
  // 반드시 한 번 돈 뒤여야 한다.
  it("두 번째 갱신은 크론이 캐시를 비운 뒤다", () => {
    const [, second] = refreshDelaysAfterEnd(() => 0)
    expect(second).toBeGreaterThanOrEqual(CACHE_SETTLE_MS)
    expect(CACHE_SETTLE_MS).toBeGreaterThan(70 * 1000)
  })

  it("손님마다 흩어진다", () => {
    const [firstLow, secondLow] = refreshDelaysAfterEnd(() => 0)
    const [firstHigh, secondHigh] = refreshDelaysAfterEnd(() => 0.999)
    expect(firstHigh).toBeGreaterThan(firstLow)
    expect(secondHigh).toBeGreaterThan(secondLow)
  })
})

describe("createEndRefreshScheduler", () => {
  // 첫 갱신이 섹션을 없애도 두 번째는 돌아야 한다. 예약만 있고 취소 수단이 없는 게 요점이다.
  it("두 시점을 모두 예약하고 같은 마감은 다시 예약하지 않는다", () => {
    const calls: number[] = []
    const schedule = createEndRefreshScheduler(
      (_run, ms) => calls.push(ms),
      () => [1000, 80000]
    )

    schedule("2026-09-23T06:30:00Z", () => {})
    schedule("2026-09-23T06:30:00Z", () => {})

    expect(calls).toEqual([1000, 80000])
  })
})
