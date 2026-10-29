// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ProductModel3dViewer } from "./index"

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

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
  mountViewer.mockReset().mockResolvedValue(disposeViewer)
  disposeViewer.mockReset()
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

async function render(fileId: unknown) {
  await act(async () => {
    root.render(
      <ProductModel3dViewer fileId={fileId} productName="테스트 상품" />
    )
  })
}

async function open() {
  await act(async () => {
    const button = container.querySelector("button")!
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

describe("ProductModel3dViewer", () => {
  it.each([undefined, null, "", "  ", 12, {}])(
    "hides the button for an absent or invalid model: %s",
    async (id) => {
      await render(id)

      expect(container.querySelector("button")).toBeNull()
      expect(mountViewer).not.toHaveBeenCalled()
    }
  )

  it("keeps the model unloaded until an explicit click, including hover and focus", async () => {
    await render("model-file")
    const button = container.querySelector("button")!

    await act(async () => {
      button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
      button.focus()
    })

    expect(button.textContent).toContain("3D로 보기")
    expect(mountViewer).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()

    await open()

    expect(mountViewer).toHaveBeenCalledTimes(1)
    expect(mountViewer.mock.calls[0][1]).toMatchObject({
      src: "https://files.test/files/public/model-file",
      alt: "테스트 상품 3D 모델",
    })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "대표 옵션 기준"
    )
  })

  it("shows loading and model errors and retries on reopen", async () => {
    await render("model-file")
    await open()

    expect(document.body.textContent).toContain("3D 모델을 불러오고 있어요")

    await act(async () => mountViewer.mock.calls[0][1].onError())

    expect(document.body.textContent).toContain("3D 모델을 불러오지 못했어요")
    expect(disposeViewer).toHaveBeenCalledTimes(1)
  })

  it("releases the viewer on close and restores focus to the trigger", async () => {
    await render("model-file")
    await open()

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="3D 보기 닫기"]')!
        .click()
    })

    expect(disposeViewer).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement?.textContent).toContain("3D로 보기")
  })

  it("disposes a late initialization when the dialog has already closed", async () => {
    let resolve!: (dispose: () => void) => void
    mountViewer.mockReturnValue(
      new Promise((done) => {
        resolve = done
      })
    )
    await render("model-file")
    await open()

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="3D 보기 닫기"]')!
        .click()
      resolve(disposeViewer)
    })

    expect(disposeViewer).toHaveBeenCalledTimes(1)
  })

  it("hides an old model when product metadata changes", async () => {
    await render("model-file")
    await open()
    await render("new-model")

    expect(disposeViewer).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
