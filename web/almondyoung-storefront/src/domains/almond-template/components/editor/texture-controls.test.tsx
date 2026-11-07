// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Layer } from "../../lib/document"
import { PrintEffectRows } from "./prop-sections"
import { EffectControls, type StyleTarget } from "./style-controls"

const layer: Layer = {
  id: "texture",
  name: "도형",
  type: "rect",
  x: 0,
  y: 0,
  width: 20,
  height: 20,
  fill: "#ffffff",
  texture: true,
}

let root: Root
let host: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  host = document.createElement("div")
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  vi.unstubAllGlobals()
})

describe.each([PrintEffectRows, EffectControls])("%s 질감 설정", (Controls) => {
  it("기본 그레인 40을 표시하고 종류·강도를 선택 대상에 적용한다", async () => {
    const apply = vi.fn()
    const target: StyleTarget = {
      layers: [layer, { ...layer, id: "second" }],
      apply,
      disabled: false,
      placement: "left",
    }

    await act(async () => root.render(<Controls target={target} />))

    const kinds = host.querySelector('[aria-label="종류"]')!
    const buttons = kinds.querySelectorAll("button")
    const slider = host.querySelector<HTMLInputElement>(
      'input[aria-label="강도"]'
    )!

    expect(buttons[0].textContent).toBe("그레인")
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true")
    expect(buttons[1].textContent).toBe("종이")
    expect([slider.min, slider.max, slider.value]).toEqual(["1", "100", "40"])

    await act(async () => buttons[1].click())

    expect(apply).toHaveBeenLastCalledWith({ textureKind: "paper" })

    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(slider, "70")
      slider.dispatchEvent(new Event("input", { bubbles: true }))
    })

    expect(apply).toHaveBeenLastCalledWith({ textureAmount: 70 })

    await act(async () =>
      root.render(<Controls target={{ ...target, disabled: true }} />)
    )

    expect(slider.disabled).toBe(true)
    expect(buttons[1].disabled).toBe(true)

    await act(async () =>
      root.render(
        <Controls
          target={{ ...target, layers: [{ ...layer, texture: false }] }}
        />
      )
    )

    expect(host.querySelector('[aria-label="종류"]')).toBeNull()
    expect(host.querySelector('[aria-label="강도"]')).toBeNull()
  })
})
