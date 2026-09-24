import { afterEach, expect, test, vi } from "vitest"
import { onPaginationArrowKey } from "./pagination-keyboard"

afterEach(() => vi.unstubAllGlobals())

test("arrow keys page forward, except while typing", () => {
  class Target {
    constructor(private editable = false) {}
    closest(selector: string) {
      return this.editable && selector.includes("input") ? this : null
    }
  }
  vi.stubGlobal("Element", Target)

  const click = vi.fn()
  vi.stubGlobal("document", {
    querySelectorAll: () => [
      {
        getClientRects: () => [{}],
        closest: () => null,
        matches: () => false,
        click,
      },
    ],
  })

  const preventDefault = vi.fn()
  onPaginationArrowKey({
    key: "ArrowRight",
    target: new Target(),
    preventDefault,
  } as unknown as KeyboardEvent)
  expect(click).toHaveBeenCalledOnce()
  expect(preventDefault).toHaveBeenCalledOnce()

  onPaginationArrowKey({
    key: "ArrowRight",
    target: new Target(true),
    preventDefault,
  } as unknown as KeyboardEvent)
  expect(click).toHaveBeenCalledOnce()
})
