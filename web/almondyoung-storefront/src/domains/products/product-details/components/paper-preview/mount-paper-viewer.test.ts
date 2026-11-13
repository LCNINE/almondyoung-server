// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { newDesign } from "@/domains/almond-template/lib/document"
import { mountPaperViewer } from "./mount-paper-viewer"

const { getTemplate, print, raster, createTexture, faces, dispose, mount } =
  vi.hoisted(() => ({
    getTemplate: vi.fn(),
    print: vi.fn(),
    raster: vi.fn(),
    createTexture: vi.fn(),
    faces: [
      "card_front",
      "card_back",
      "card_edge",
      "card_front",
      "card_back",
      "card_edge",
    ].map((name) => ({
      name,
      ensureLoaded: vi.fn(),
      pbrMetallicRoughness: { baseColorTexture: { setTexture: vi.fn() } },
    })),
    dispose: vi.fn(),
    mount: vi.fn(),
  }))
vi.mock("@/lib/api/ugc/almond-templates", () => ({
  getAlmondTemplate: getTemplate,
}))
vi.mock("@/domains/almond-template/components/print-svg", () => ({
  printSvg: print,
}))
vi.mock("@/domains/almond-template/lib/design-images", () => ({
  rasterPng: raster,
}))
vi.mock("../model3d-viewer/mount-viewer", () => ({ mountViewer: mount }))

let container: HTMLDivElement
let onLoad: () => void
let reducedMotion = false
let updateMotion: () => void
const contextDescriptor = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  "getContext"
)!

beforeEach(() => {
  vi.clearAllMocks()
  container = document.createElement("div")
  reducedMotion = false
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reducedMotion
    },
    addEventListener: (_: string, listener: () => void) => {
      updateMotion = listener
    },
    removeEventListener: vi.fn(),
  }))
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ fillStyle: "", fillRect: vi.fn() }),
  })
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;plain"
  )
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:art"),
  })
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  })
  getTemplate.mockResolvedValue({ design: newDesign("bizcard") })
  print.mockImplementation(async (_design, side: string) => side)
  raster.mockResolvedValue(new Blob(["png"], { type: "image/png" }))
  createTexture.mockImplementation(async (url: string) => ({ source: url }))
  faces.forEach((face) => face.ensureLoaded.mockResolvedValue(undefined))
  mount.mockImplementation(
    async (target: HTMLElement, options: { onLoad: () => void }) => {
      onLoad = options.onLoad
      const viewer = document.createElement("model-viewer")
      Object.assign(viewer, {
        model: { materials: faces },
        createTexture,
        jumpCameraToGoal: vi.fn(),
      })
      target.append(viewer)
      dispose.mockImplementation(() => viewer.remove())

      return dispose
    }
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Object.defineProperty(
    HTMLCanvasElement.prototype,
    "getContext",
    contextDescriptor
  )
})

async function setup() {
  const onReady = vi.fn()
  const onError = vi.fn()
  const cleanup = await mountPaperViewer(container, {
    templateId: "template",
    alt: "Card",
    interactionPrompt: "Drag",
    variant: () => "matte_coated",
    onReady,
    onError,
  })

  return { cleanup, onReady, onError }
}

async function load() {
  onLoad()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe("paper model", () => {
  it("applies front artwork to both variants and keeps an empty back plain", async () => {
    const { cleanup, onReady } = await setup()
    await load()

    expect(onReady).toHaveBeenCalledOnce()
    expect(getTemplate).toHaveBeenCalledWith("template")
    expect(print).toHaveBeenCalledExactlyOnceWith(expect.anything(), "front", 0)
    expect(raster).toHaveBeenCalledWith("front", 1600)
    for (const face of faces) {
      const setTexture = face.pbrMetallicRoughness.baseColorTexture.setTexture
      if (face.name === "card_edge") {
        expect(setTexture).not.toHaveBeenCalled()
      } else {
        expect(face.ensureLoaded).toHaveBeenCalledOnce()
        expect(setTexture).toHaveBeenLastCalledWith({
          source:
            face.name === "card_front" ? "blob:art" : "data:image/png;plain",
        })
      }
    }

    cleanup()
    expect(container.children).toHaveLength(0)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:art")
  })

  it("renders a back background even without back layers", async () => {
    getTemplate.mockResolvedValue({
      design: {
        ...newDesign("card"),
        backBackground: { background: "#123456" },
      },
    })
    const { cleanup } = await setup()
    await load()

    expect(print).toHaveBeenCalledWith(expect.anything(), "back", 0)
    expect(raster).toHaveBeenCalledWith("back", 1600)
    expect(
      faces[1].pbrMetallicRoughness.baseColorTexture.setTexture
    ).toHaveBeenLastCalledWith({ source: "blob:art" })
    cleanup()
  })

  it.each(["api", "render"])(
    "keeps all faces plain on %s failure",
    async (stage) => {
      if (stage === "api") getTemplate.mockRejectedValue(new Error("offline"))
      else raster.mockRejectedValue(new Error("font unavailable"))
      const { cleanup, onReady, onError } = await setup()
      await load()

      expect(onReady).toHaveBeenCalledOnce()
      expect(onError).not.toHaveBeenCalled()
      expect(
        faces[0].pbrMetallicRoughness.baseColorTexture.setTexture
      ).toHaveBeenCalledExactlyOnceWith({ source: "data:image/png;plain" })
      cleanup()
    }
  )

  it("uses the approved camera, material and lighting, and respects motion changes", async () => {
    reducedMotion = true
    const { cleanup } = await setup()
    const viewer = container.querySelector("model-viewer")!

    expect(viewer.variantName).toBe("matte_coated")
    expect(viewer.getAttribute("environment-image")).toBe("neutral")
    expect(viewer.getAttribute("exposure")).toBe("1.15")
    expect(viewer.getAttribute("camera-orbit")).toBe("30deg 66deg 0.24m")
    expect(viewer.getAttribute("field-of-view")).toBe("28deg")
    expect(viewer.getAttribute("rotation-per-second")).toBe("8deg")
    expect(viewer.hasAttribute("auto-rotate")).toBe(false)
    reducedMotion = false
    updateMotion()
    expect(viewer.hasAttribute("auto-rotate")).toBe(true)
    cleanup()
  })

  it("does not create URLs or update materials after disposal during rendering", async () => {
    let finish: (blob: Blob) => void = () => {}
    raster.mockReturnValue(
      new Promise<Blob>((resolve) => {
        finish = resolve
      })
    )
    const { cleanup } = await setup()
    await load()
    cleanup()
    finish(new Blob(["late"]))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(
      faces[0].pbrMetallicRoughness.baseColorTexture.setTexture
    ).toHaveBeenCalledTimes(1)
  })
})
