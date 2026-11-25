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
  cartHasCustomerPrintFile,
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

  it("asks for the agreement when the cart carries a customer print file", () => {
    const items = [{ metadata: { print_file_id: "f1" } }]
    expect(isCustomOrderPaymentBlocked(items, false)).toBe(true)
    expect(cartHasCustomerPrintFile(items)).toBe(true)
    expect(
      cartHasCustomerPrintFile([{ metadata: { almond_design_id: "d1" } }])
    ).toBe(false)
  })

  it("adds the file-defect line and agreement only for customer files", () => {
    const html = renderToStaticMarkup(
      createElement(CustomOrderNotice, {
        withAgreement: true,
        withCustomerFile: true,
      })
    )
    expect(html).toContain("checkout.customOrderNotice.fileStepTitle")
    expect(html).toContain("checkout.customOrderNotice.agreeWithFile")
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
    expect(plain).toContain("productDetail.customOrderNotice.headline")
    expect(plain).toContain("productDetail.customOrderNotice.step2Title")
    expect(plain).toContain("productDetail.customOrderNotice.step3Body")
    expect(plain).toContain("productDetail.customOrderNotice.otherItems")
  })
})
