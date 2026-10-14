import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createTranslator } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import messages from "@/i18n/messages/ko/mypage.json"
import type {
  SubscriptionDetailsDto,
  SubscriptionHistoryItemDto,
} from "@/lib/types/dto/membership"

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>()

  return { ...actual, useState: () => [true, vi.fn()] }
})
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>()

  return {
    ...actual,
    useTranslations: () =>
      createTranslator({
        locale: "ko",
        messages: { mypage: messages },
        namespace: "mypage.membership",
      }),
  }
})
vi.mock("next/navigation", () => ({
  useParams: () => ({ countryCode: "kr" }),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("@lib/api/wallet", () => ({ getCmsBillingMethodStatuses: vi.fn() }))
vi.mock("@lib/utils/invoice-billing", () => ({
  isInvoiceBillingEnabled: () => false,
}))
vi.mock("./savings-section", () => ({ default: () => null }))

import MemberDetails from "./member-details"
import MembershipHistorySection from "./subscriber-history-section"
import HistoryCard from "@/app/[countryCode]/(mypage)/mypage/membership/history/history-card"

const item: SubscriptionHistoryItemDto = {
  id: "grant",
  userId: "user",
  planId: "monthly",
  status: "ACTIVE",
  createdAt: "2026-09-28T00:00:00Z",
  updatedAt: "2026-09-28T00:00:00Z",
  endDate: "2026-09-30T00:00:00Z",
  billingDate: "2099-10-01",
  nextBillingDate: "2099-11-01",
  autoRenewal: true,
  adminGrant: { days: 2 },
  plan: { durationDays: 30, price: 9900, currency: "KRW" },
}

const renderHistory = [
  (value: SubscriptionHistoryItemDto) =>
    renderToStaticMarkup(createElement(HistoryCard, { item: value })),
  (value: SubscriptionHistoryItemDto) =>
    renderToStaticMarkup(
      createElement(MembershipHistorySection, { subscriptionHistory: [value] })
    ),
]

describe("임시 이용권 표시 (#1056)", () => {
  it.each(renderHistory)(
    "이력에 지급 일수와 종료일을 표시하고 복사된 요금·정기결제 안내를 숨긴다",
    (render) => {
      const html = render(item)

      expect(html).toContain("임시 이용권 (2일)")
      expect(html).toContain("결제 없음")
      expect(html).toContain("2026.09.30")
      expect(html).not.toContain("월간 구독")
      expect(html).not.toContain("9,900")
      expect(html).not.toContain("다음 결제")
      expect(html).not.toContain("자동결제 시작")
      expect(html).not.toContain("정기결제")
    }
  )

  it.each(renderHistory)("만료된 이용권에도 지급 일수를 표시한다", (render) => {
    const html = render({ ...item, status: "EXPIRED" })

    expect(html).toContain("임시 이용권 (2일)")
    expect(html).not.toContain("월간 구독")
  })

  it.each(renderHistory)(
    "결제 가입 이력은 기존 월간 구독 표시를 유지한다",
    (render) => {
      const html = render({
        ...item,
        adminGrant: null,
        billingDate: "2026-09-28",
      })

      expect(html).toContain("월간 구독")
      expect(html).toContain("9,900")
      expect(html).toContain("다음 결제")
      expect(html).not.toContain("임시 이용권")
    }
  )

  it("현재 상태에는 임시 이용권과 종료일을 표시한다", () => {
    const html = renderToStaticMarkup(
      createElement(MemberDetails, {
        membershipData: {
          ...item,
          paymentActionNeeded: true,
        } as unknown as SubscriptionDetailsDto,
        savingsOverview: null,
      })
    )

    expect(html).toContain("임시 이용권 (2일)")
    expect(html).toContain("2026년 9월 30일")
    expect(html).toContain("자동결제되지 않습니다")
    expect(html).not.toContain("다음 결제")
    expect(html).not.toContain("무료 체험")
    expect(html).not.toContain("은행 확인 중")
  })

  it("현재 유료 구독은 다음 결제일을 유지한다", () => {
    const html = renderToStaticMarkup(
      createElement(MemberDetails, {
        membershipData: {
          ...item,
          adminGrant: null,
          billingDate: "2026-09-28",
        } as unknown as SubscriptionDetailsDto,
        savingsOverview: null,
      })
    )

    expect(html).toContain("다음 결제 예정일")
    expect(html).not.toContain("임시 이용권")
  })
})
