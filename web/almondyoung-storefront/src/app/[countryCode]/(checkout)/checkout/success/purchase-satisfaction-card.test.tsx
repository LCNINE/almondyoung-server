import { describe, expect, it, vi } from "vitest"
vi.mock("@/lib/api/medusa/purchase-satisfaction", () => ({
  savePurchaseSatisfaction: vi.fn(),
}))

import { renderToStaticMarkup } from "react-dom/server"
import { NextIntlClientProvider } from "next-intl"
import ko from "@/i18n/messages/ko/checkout.json"
import { PurchaseSatisfactionView } from "./purchase-satisfaction-card"
import type { SatisfactionState } from "./purchase-satisfaction-flow"

const base: SatisfactionState = {
  step: "rate",
  rating: 0,
  saving: false,
  failed: false,
  reasons: [],
  memo: "",
}

const noop = () => {}
const html = (patch: Partial<SatisfactionState>) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="ko" messages={{ checkout: ko }}>
      <PurchaseSatisfactionView
        state={{ ...base, ...patch }}
        canSubmit={patch.reasons?.length ? true : (patch.memo ?? "").trim() !== ""}
        onSelectRating={noop}
        onToggleReason={noop}
        onMemo={noop}
        onSkip={noop}
        onSubmit={noop}
        onChangeRating={noop}
      />
    </NextIntlClientProvider>
  )

describe("PurchaseSatisfactionView", () => {
  it("별 선택 단계: 제목·부제·별 5개", () => {
    const h = html({})
    expect(h).toContain("구매 과정은 어땠나요?")
    expect(h).toContain("상품 후기는 받아보신 뒤에 남길 수 있어요")
    expect(h.match(/aria-label="\d점"/g)).toHaveLength(5)
  })

  it("세부 단계: 질문과 칩 7개, 칩이 없으면 보내기 disabled", () => {
    const h = html({ step: "detail", rating: 3 })
    expect(h).toContain("어떤 점이 아쉬웠나요?")
    expect(h.match(/data-reason=/g)).toHaveLength(7)
    expect(h).toMatch(/<button[^>]*\sdisabled=""[^>]*>보내기/)
    expect(h).toContain("다음에")
    expect(h).toContain("0/300")
  })

  it("칩을 고르면 보내기 활성", () => {
    const h = html({ step: "detail", rating: 3, reasons: ["OTHER"] })
    expect(h).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>보내기/)
  })

  it("감사 단계: 점수에 따라 설명이 다르다", () => {
    expect(html({ step: "thanks", rating: 5 })).toContain("다음에도 만족스러운 쇼핑을 준비하겠습니다")
    const low = html({ step: "thanks", rating: 2 })
    expect(low).toContain("소중한 의견 감사합니다")
    expect(low).toContain("남겨 주신 내용을 바탕으로 개선하겠습니다")
    expect(low).toContain("별점 바꾸기")
  })

  it("저장 실패 문구와 저장 중 문구", () => {
    expect(html({ failed: true })).toContain("저장하지 못했어요. 별을 다시 눌러 주세요")
    expect(html({ saving: true, rating: 3 })).toContain("저장하고 있어요")
  })

  it("주황 텍스트 클래스를 쓰지 않는다", () => {
    const h = html({ step: "detail", rating: 2, reasons: ["OTHER"] })
    expect(h).not.toMatch(/text-\[#(ffa500|FFA500)\]|text-orange/)
  })
})
