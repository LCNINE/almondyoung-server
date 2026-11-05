// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { NextIntlClientProvider } from "next-intl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import ko from "@/i18n/messages/ko/productDetail.json"
import en from "@/i18n/messages/en/productDetail.json"
import ja from "@/i18n/messages/ja/productDetail.json"
import { canAutoLoad3d, ProductModel3dLayer } from "./index"

const { mountViewer, disposeViewer } = vi.hoisted(() => ({
  mountViewer: vi.fn(),
  disposeViewer: vi.fn(),
}))

vi.mock("./mount-viewer", () => ({ mountViewer }))
vi.mock("@/lib/utils/get-thumbnail-url", () => ({
  getThumbnailUrl: (id: string) => `https://files.test/files/public/${id}`,
}))

let root: Root
let container: HTMLDivElement
let idleCallbacks: (() => void)[]

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  mountViewer.mockReset().mockResolvedValue(disposeViewer)
  disposeViewer.mockReset()
  idleCallbacks = []
  vi.stubGlobal("requestIdleCallback", (run: () => void) => {
    idleCallbacks.push(run)

    return idleCallbacks.length
  })
  vi.stubGlobal("cancelIdleCallback", () => {})
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function render(
  fileId: unknown,
  {
    visible = true,
    locale = "ko",
    onStatus,
  }: {
    visible?: boolean
    locale?: "ko" | "en" | "ja"
    onStatus?: (status: string) => void
  } = {}
) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider
        locale={locale}
        messages={{ productDetail: { ko, en, ja }[locale] }}
      >
        <ProductModel3dLayer
          fileId={fileId}
          productName="테스트 상품"
          visible={visible}
          onStatus={onStatus}
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

function layer() {
  return container.firstElementChild as HTMLElement | null
}

describe("canAutoLoad3d", () => {
  it.each([
    [{}, true],
    [{ connection: { effectiveType: "4g" }, deviceMemory: 8 }, true],
    [{ deviceMemory: 4 }, true],
    [{ connection: { saveData: true, effectiveType: "4g" } }, false],
    [{ connection: { effectiveType: "3g" } }, false],
    [{ connection: { effectiveType: "slow-2g" } }, false],
    [{ deviceMemory: 2 }, false],
  ])("%j → %s", (hints, expected) => {
    expect(canAutoLoad3d(hints)).toBe(expected)
  })
})

describe("ProductModel3dLayer", () => {
  it.each([undefined, null, "", "  ", 12, {}])(
    "renders nothing for an absent or invalid model: %s",
    async (id) => {
      await render(id)
      await idle()

      expect(layer()).toBeNull()
      expect(mountViewer).not.toHaveBeenCalled()
    }
  )

  it("downloads after the page is idle and shows loading until the model is ready", async () => {
    await render("model-file")

    expect(mountViewer).not.toHaveBeenCalled()

    await idle()

    expect(mountViewer).toHaveBeenCalledTimes(1)
    expect(mountViewer.mock.calls[0][1]).toMatchObject({
      src: "https://files.test/files/public/model-file",
      alt: "테스트 상품 3D 모델",
    })
    expect(layer()?.querySelector('[role="status"]')?.textContent).toContain(
      "3D 모델을 불러오고 있어요"
    )

    await act(async () => mountViewer.mock.calls[0][1].onLoad())

    expect(layer()?.querySelector('[role="status"]')).toBeNull()
    expect(layer()?.className).toContain("opacity-100")
    expect(layer()?.textContent).toContain("대표 옵션 기준")
  })

  it("reports loading then ready to the gallery", async () => {
    const onStatus = vi.fn()
    await render("model-file", { onStatus })

    expect(onStatus.mock.calls).toEqual([["loading"]])

    await idle()
    await act(async () => mountViewer.mock.calls[0][1].onLoad())

    expect(onStatus.mock.calls).toEqual([["loading"], ["ready"]])
  })

  it("zooms the viewer with the buttons", async () => {
    const zoom = vi.fn()
    mountViewer.mockImplementation(async (target: HTMLElement) => {
      const viewer = document.createElement("model-viewer")
      Object.assign(viewer, { zoom })
      target.append(viewer)

      return disposeViewer
    })
    await render("model-file")
    await idle()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="확대"]')!.click()
      container.querySelector<HTMLButtonElement>('[aria-label="축소"]')!.click()
    })

    expect(zoom.mock.calls).toEqual([[3], [-3]])
  })

  it("uses the locale for the option warning", async () => {
    await render("model-file", { locale: "en" })

    expect(layer()?.textContent).toContain("Based on a representative option")
  })

  it("hides the model while another photo is selected", async () => {
    await render("model-file")
    await idle()
    await act(async () => mountViewer.mock.calls[0][1].onLoad())
    await render("model-file", { visible: false })

    expect(layer()?.className).toContain("opacity-0")
    expect(mountViewer).toHaveBeenCalledTimes(1)
  })

  it("reports a failed model so the gallery drops the 3D slot", async () => {
    const onStatus = vi.fn()
    await render("model-file", { onStatus })
    await idle()
    await act(async () => mountViewer.mock.calls[0][1].onError())

    expect(onStatus).toHaveBeenLastCalledWith("failed")
  })

  it("reports failure when WebGL is unavailable", async () => {
    const onStatus = vi.fn()
    mountViewer.mockRejectedValue(new Error("WebGL 2 is not available"))
    await render("model-file", { onStatus })
    await idle()

    expect(onStatus).toHaveBeenLastCalledWith("failed")
  })

  it("never offers 3D on data saver", async () => {
    const onStatus = vi.fn()
    vi.stubGlobal("navigator", { ...navigator, connection: { saveData: true } })
    await render("model-file", { onStatus })
    await idle()

    expect(mountViewer).not.toHaveBeenCalled()
    expect(onStatus).not.toHaveBeenCalled()
  })

  it("releases the old model when the product changes", async () => {
    await render("model-file")
    await idle()
    await render("new-model")
    await idle()

    expect(disposeViewer).toHaveBeenCalledTimes(1)
    expect(mountViewer).toHaveBeenCalledTimes(2)
  })

  it("disposes a late initialization after unmount", async () => {
    let resolve!: (dispose: () => void) => void
    mountViewer.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    await render("model-file")
    await idle()
    await act(async () => root.unmount())
    await act(async () => resolve(disposeViewer))

    expect(disposeViewer).toHaveBeenCalledTimes(1)
    root = createRoot(container)
  })
})
