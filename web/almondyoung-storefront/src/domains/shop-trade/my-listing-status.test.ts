import { describe, expect, it } from "vitest"
import { editRequiresReReview, myListingActions } from "./my-listing-status"

describe("myListingActions (spec §8.1 표)", () => {
  it.each([
    ["published", ["edit", "close", "delete"]],
    ["closed", ["edit", "reopen", "delete"]],
    ["pending", ["edit", "delete"]],
    ["rejected", ["edit", "delete"]],
    ["hidden", ["delete"]],
  ] as const)("%s → %j", (status, expected) => {
    expect(myListingActions(status)).toEqual(expected)
  })
})

describe("editRequiresReReview", () => {
  it("공개 중인 글(게시·거래완료)만 수정하면 비공개로 내려간다", () => {
    expect(editRequiresReReview("published")).toBe(true)
    expect(editRequiresReReview("closed")).toBe(true)
    expect(editRequiresReReview("pending")).toBe(false)
    expect(editRequiresReReview("rejected")).toBe(false)
    expect(editRequiresReReview("hidden")).toBe(false)
  })
})
