import { describe, expect, it } from "vitest"
import type { RefundSummary } from "@/lib/api/orders/store-orders"
import en from "@/i18n/messages/en/mypage.json"
import ja from "@/i18n/messages/ja/mypage.json"
import ko from "@/i18n/messages/ko/mypage.json"
import { KNOWN_REFUND_STATUSES, refundTone, resolveRefundStatus, toRefundStatus } from "./refund-status"

const KNOWN = ["none", "pending", "manual_pending", "succeeded", "failed", "delayed", "transfer_pending"]

describe("toRefundStatus — core 가 먼저 값을 늘려도 배지가 사라지지 않는다(#1016 36번 PR 4)", () => {
  it("알려진 값은 일곱이다", () => {
    expect([...KNOWN_REFUND_STATUSES].sort()).toEqual([...KNOWN].sort())
  })

  it.each(KNOWN)("알려진 값 %s 는 그대로", (value) => {
    expect(toRefundStatus(value)).toBe(value)
  })

  it.each(["something_new", "", "PENDING", "settling"])("모르는 값 %j 는 환불 처리 중(pending)", (value) => {
    expect(toRefundStatus(value)).toBe("pending")
  })

  it.each(["toString", "constructor", "__proto__", "hasOwnProperty"])("프로토타입 이름 %j 도 모르는 값", (value) => {
    expect(toRefundStatus(value)).toBe("pending")
  })

  it.each([undefined, null])("값 없음(%s)은 none — 정보가 없는 주문에 «처리 중»을 띄우지 않는다", (value) => {
    expect(toRefundStatus(value)).toBe("none")
  })
})

describe("resolveRefundStatus — 상세는 환불 요약의 상태를 우선한다", () => {
  const summary = (status: string): RefundSummary => ({
    status,
    amount: null,
    currency: "KRW",
    paymentMethodLabel: null,
    manualRequired: false,
    expectedProcessingMessage: null,
    lastUpdatedAt: null,
  })

  it("core 응답이 없으면 none", () => {
    expect(resolveRefundStatus(undefined)).toBe("none")
    expect(resolveRefundStatus(null)).toBe("none")
  })

  it("요약이 없으면 주문의 환불 상태", () => {
    expect(resolveRefundStatus({ refundStatus: "succeeded" })).toBe("succeeded")
  })

  it("요약이 있으면 요약의 상태 — 주문은 none 이어도(운영자 부분취소 정산)", () => {
    expect(resolveRefundStatus({ refundStatus: "none", refundSummary: summary("delayed") })).toBe("delayed")
  })

  it("어느 쪽이든 모르는 값은 pending", () => {
    expect(resolveRefundStatus({ refundStatus: "settle_new" })).toBe("pending")
    expect(resolveRefundStatus({ refundStatus: "pending", refundSummary: summary("settle_new") })).toBe("pending")
  })
})

describe("refundTone — 고객에게는 지연과 거절을 구분하지 않는다(스펙 §5.2)", () => {
  it.each([
    ["none", null],
    ["pending", "progress"],
    ["manual_pending", "progress"],
    ["delayed", "progress"],
    ["transfer_pending", "progress"],
    ["succeeded", "done"],
    ["failed", "problem"],
  ] as const)("%s → %s", (status, tone) => {
    expect(refundTone(status)).toBe(tone)
  })
})

describe("문구 — 세 언어 모두 알려진 값마다 라벨과 안내가 있다", () => {
  // locale-parity.test.ts 가 develop 에서 이미 빨개(logoContest) 새 누락을 못 가린다 — 여기서 직접 본다
  it.each([
    ["ko", ko],
    ["en", en],
    ["ja", ja],
  ] as const)("%s", (_, messages) => {
    const labels: Record<string, string> = messages.order.refundInfo.statusLabels
    const guidance: Record<string, string> = messages.order.refundInfo.guidance
    for (const status of KNOWN_REFUND_STATUSES) {
      expect(labels, status).toHaveProperty(status)
      expect(guidance, status).toHaveProperty(status)
      if (status !== "none") expect(labels[status], status).not.toBe("")
    }
  })

  it("ko 는 스펙 §8.2 의 낱말 그대로", () => {
    const { statusLabels, guidance }: { statusLabels: Record<string, string>; guidance: Record<string, string> } =
      ko.order.refundInfo
    expect(statusLabels.delayed).toBe("환불이 늦어지고 있어요")
    expect(guidance.delayed).toBe("영업일 3일 안에 처리해 드릴게요.")
    expect(statusLabels.transfer_pending).toBe("환불 진행 중")
    expect(guidance.transfer_pending).toBe("계좌로 송금해 드릴 예정이에요.")
  })
})
