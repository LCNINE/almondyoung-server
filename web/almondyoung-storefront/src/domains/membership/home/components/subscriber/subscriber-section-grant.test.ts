import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createTranslator } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import messages from "@/i18n/messages/ko/mypage.json"
import type {
  CancellationPreviewDto,
  SubscriptionDetailsDto,
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
vi.mock("./membership-invoices-section", () => ({ default: () => null }))
vi.mock("@/domains/membership/components/status-selection", () => ({
  default: () => null,
}))
vi.mock("./member-details", () => ({ default: () => null }))
vi.mock("@/lib/api/membership", () => ({
  cancelSubscription: vi.fn(),
  undoCancellation: vi.fn(),
}))
vi.mock("../../poll-cart-refresh", () => ({
  pollCartRefreshUntilGroupRemoved: vi.fn(),
}))
vi.mock("../../../components/modal", () => ({
  MembershipCancelModal: () => null,
}))
vi.mock("@/components/shared/localized-client-link", () => ({
  default: ({ children }: { children: unknown }) => children,
}))

import SubscriberSection from "./subscriber-section"

const preview = {
  contractId: "c1",
  isRecurring: false,
  alreadyScheduledForCancellation: true,
  recurringCancelledAt: "2026-09-29T00:00:00Z",
  currentPeriodEndsAt: "2026-09-30T00:00:00Z",
  canUndoCancellation: false,
  options: [],
} as unknown as CancellationPreviewDto

const render = (
  adminGrant: { days: number } | null,
  cancellationPreview: CancellationPreviewDto
) =>
  renderToStaticMarkup(
    createElement(SubscriberSection, {
      membershipData: { adminGrant } as unknown as SubscriptionDetailsDto,
      plans: [],
      savingsOverview: null,
      subscriptionHistory: [],
      cancellationReasons: [],
      cancellationPreview,
      hasCafe24Link: false,
    })
  )

describe("임시 이용권 해지 UI", () => {
  it("해지 버튼, 예약 배너, 1회 결제 안내를 숨기고 자동 종료 안내만 보여 준다", () => {
    const html = render({ days: 2 }, preview)

    expect(html).toContain("종료일까지 이용하면 자동으로 끝나요")
    expect(html).not.toContain("멤버십 해지")
    expect(html).not.toContain("되돌릴 자동결제가 없습니다")
  })

  it("미리보기의 isAdminGrant 만으로도 해지 버튼을 숨긴다", () => {
    const html = render(null, {
      ...preview,
      alreadyScheduledForCancellation: false,
      recurringCancelledAt: null,
      isAdminGrant: true,
    })

    expect(html).toContain("종료일까지 이용하면 자동으로 끝나요")
    expect(html).not.toContain("멤버십 해지")
  })

  it("유료 계약은 해지 버튼을 유지하고 자동 종료 안내를 그리지 않는다", () => {
    const html = render(null, {
      ...preview,
      alreadyScheduledForCancellation: false,
      recurringCancelledAt: null,
    })

    expect(html).toContain("멤버십 해지")
    expect(html).not.toContain("종료일까지 이용하면 자동으로 끝나요")
  })
})
