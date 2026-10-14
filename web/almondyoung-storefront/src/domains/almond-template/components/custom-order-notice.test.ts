import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) =>
    Object.assign((key: string) => `${ns}.${key}`, {
      rich: (key: string, tags: { strong: (chunks: string) => unknown }) =>
        tags.strong(`${ns}.${key}`),
    }),
}))

import {
  CustomOrderNotice,
  isCustomOrderPaymentBlocked,
} from "./custom-order-notice"

describe("custom order notice", () => {
  it("disables payment until the custom order notice is agreed", () => {
    const items = [{ metadata: { almond_design_id: "d1" } }, { metadata: null }]
    expect(isCustomOrderPaymentBlocked(items, false)).toBe(true)
    expect(isCustomOrderPaymentBlocked(items, true)).toBe(false)
    expect(isCustomOrderPaymentBlocked([{ metadata: {} }], false)).toBe(false)
    expect(isCustomOrderPaymentBlocked([], false)).toBe(false)
  })

  it("renders an unchecked agreement checkbox only with withAgreement", () => {
    const withBox = renderToStaticMarkup(
      createElement(CustomOrderNotice, {
        withAgreement: true,
        agreed: false,
        onAgreeChange: () => {},
      })
    )
    expect(withBox).toContain('type="checkbox"')
    expect(withBox).not.toContain("checked")
    expect(withBox).toContain("checkout.customOrderNotice.agree")

    const checked = renderToStaticMarkup(
      createElement(CustomOrderNotice, {
        withAgreement: true,
        agreed: true,
        onAgreeChange: () => {},
      })
    )
    expect(checked).toContain("checked")

    const plain = renderToStaticMarkup(createElement(CustomOrderNotice))
    expect(plain).not.toContain('type="checkbox"')
    expect(plain).toContain(
      '<strong class="font-bold text-gray-900">productDetail.customOrderNotice.body2</strong>'
    )
    expect(plain).toContain("productDetail.customOrderNotice.body4")
  })
})
