// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ko from "@/i18n/messages/ko/productDetail.json"
import en from "@/i18n/messages/en/productDetail.json"
import ja from "@/i18n/messages/ja/productDetail.json"
import PaperPreview from "./index"
import type { PaperVariant } from "./paper"

const { mount, dispose } = vi.hoisted(() => ({
  mount: vi.fn(),
  dispose: vi.fn(),
}))
vi.mock("./mount-paper-viewer", () => ({ mountPaperViewer: mount }))
vi.mock("@/hooks/use-intersection", () => ({ useIntersection: () => true }))

let root: Root
let container: HTMLDivElement
let idleCallbacks: (() => void)[]

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  idleCallbacks = []
  dispose.mockReset()
  mount
    .mockReset()
    .mockImplementation(
      async (
        target: HTMLElement,
        options: { onReady: () => void; variant: () => PaperVariant }
      ) => {
        const viewer = document.createElement("model-viewer")
        viewer.variantName = options.variant()
        target.append(viewer)
        options.onReady()
        dispose.mockImplementation(() => viewer.remove())

        return dispose
      }
    )
  vi.stubGlobal("requestIdleCallback", (run: () => void) =>
    idleCallbacks.push(run)
  )
  vi.stubGlobal("cancelIdleCallback", vi.fn())
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(
  variant: PaperVariant = "uncoated",
  locale: "ko" | "en" | "ja" = "ko"
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider
        locale={locale}
        messages={{ productDetail: { ko, en, ja }[locale] }}
      >
        <PaperPreview
          templateId="template"
          productName="Almond"
          variant={variant}
        />
      </NextIntlClientProvider>
    )
  })
}

async function idle() {
  await act(async () => {
    idleCallbacks.splice(0).forEach((run) => run())
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("paper preview", () => {
  it.each(["ko", "en", "ja"] satisfies ("ko" | "en" | "ja")[])(
    "renders translated close-ups and descriptions in %s without 3D on data saver",
    async (locale) => {
      vi.stubGlobal("navigator", { connection: { saveData: true } })
      await render("matte_coated", locale)
      await idle()
      const messages = { ko, en, ja }[locale].paperPreview

      expect(mount).not.toHaveBeenCalled()
      expect(container.querySelectorAll("img")).toHaveLength(2)
      expect(container.querySelector("h3")?.textContent).toBe(messages.title)
      expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
        messages.matte_coated.description
      )
      expect(
        container.querySelector('[aria-current="true"]')?.textContent
      ).toBe(messages.matte_coated.caption)
      expect(container.textContent).toContain(messages.disclaimer)
    }
  )

  it("loads only after idle and switches paper without reloading artwork", async () => {
    await render()
    expect(mount).not.toHaveBeenCalled()
    await idle()
    const viewer = container.querySelector("model-viewer")!
    expect(viewer.variantName).toBe("uncoated")
    await render("matte_coated")

    expect(viewer.variantName).toBe("matte_coated")
    expect(mount).toHaveBeenCalledOnce()
    expect(container.querySelector('[aria-current="true"]')?.textContent).toBe(
      ko.paperPreview.matte_coated.caption
    )
    expect(container.textContent).toContain(ko.paperPreview.notice)
  })

  it("keeps the photos and description when WebGL or the model fails", async () => {
    mount.mockRejectedValue(new Error("WebGL unavailable"))
    await render()
    await idle()

    expect(container.querySelectorAll("img")).toHaveLength(2)
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      ko.paperPreview.uncoated.description
    )
    expect(container.textContent).not.toContain("WebGL")
  })

  it("uses the latest selection if paper changes before lazy loading finishes", async () => {
    await render()
    await render("matte_coated")
    await idle()

    expect(container.querySelector("model-viewer")?.variantName).toBe(
      "matte_coated"
    )
  })
})
