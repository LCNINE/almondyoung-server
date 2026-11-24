import { describe, expect, it } from "vitest"
import {
  acceptsCustomerFile,
  customerFileProblem,
  isMadeToOrder,
  printFileSpec,
} from "./customer-print-file"

describe("customer print file", () => {
  it("takes only the formats WowPress accepts for the product", () => {
    expect(
      customerFileProblem("invitation", { name: "청첩장.AI", size: 10 })
    ).toBeNull()
    expect(
      customerFileProblem("invitation", { name: "청첩장.pdf", size: 10 })
    ).toBe("type")
    expect(
      customerFileProblem("card", { name: "card.pdf", size: 10 })
    ).toBeNull()
    expect(customerFileProblem("pet", { name: "banner", size: 10 })).toBe(
      "type"
    )
    expect(
      customerFileProblem("mini", { name: "big.eps", size: 301 * 1024 * 1024 })
    ).toBe("size")
  })

  it("does not open customer files for banners until WowPress confirms the format", () => {
    expect(acceptsCustomerFile("window")).toBe(false)
    expect(acceptsCustomerFile("diploma")).toBe(false)
    expect(acceptsCustomerFile("invitation")).toBe(true)
  })

  it("treats the fixed ready-made print products as not made to order", () => {
    expect(isMadeToOrder("6c2b7437-7c72-4685-a72c-0cd18f9d7bfb")).toBe(false)
    expect(isMadeToOrder("a-published-template-product")).toBe(true)
  })

  it("adds the bleed on every side for the artwork size", () => {
    expect(printFileSpec("invitation", [100, 180]).work).toEqual({
      width: 102,
      height: 182,
    })
  })
})
