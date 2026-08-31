import { describe, expect, it } from "vitest"
import {
  COUNTDOWN_THRESHOLD_MS,
  formatCountdown,
  nextTickDelayMs,
  resolveCountdown,
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
