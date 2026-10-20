import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, it, vi } from "vitest"
import { newDesign, updateLayer } from "../lib/document"
import { makeLayer } from "../lib/layer"
import { useImageTools } from "./use-image-tools"

vi.mock("../lib/image-previews", () => ({
  rememberPreview: vi.fn().mockResolvedValue(undefined),
}))
afterEach(() => vi.unstubAllGlobals())

it("replaces a photo without losing effects and clears the old crop", async () => {
  let design = newDesign("card")
  design.front = [
    {
      ...makeLayer("image", design),
      image: "data:image/png;base64,b2xk",
      originalImage: "data:image/png;base64,b2xk",
      imageFilter: "sepia",
      imageMotionBlur: 75,
      imageMotionMix: 80,
      photoEffects: { gloss: 20 },
      imageMotionMask: { shape: "scratch", x: 0, y: 20, width: 70, height: 30 },
      crop: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 },
    },
  ]
  const close = vi.fn()
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ width: 800, height: 1200, close })
  )
  vi.stubGlobal(
    "FileReader",
    class {
      result = "data:image/png;base64,bmV3"
      onload?: () => void
      readAsDataURL() {
        this.onload?.()
      }
    }
  )
  let tools: ReturnType<typeof useImageTools> | undefined
  function Harness() {
    tools = useImageTools({
      design,
      side: "front",
      layers: design.front,
      selected: design.front[0],
      change: (next) => {
        design = next
      },
      patch: (id, value) => {
        design = updateLayer(design, "front", id, value)
      },
      setSelectedId: vi.fn(),
      setMessage: vi.fn(),
    })
    return null
  }
  renderToStaticMarkup(createElement(Harness))
  await tools!.imageFile(
    new File(["photo"], "replacement.png", { type: "image/png" }),
    "frame"
  )
  expect(design.front[0]).toMatchObject({
    image: "data:image/png;base64,bmV3",
    pixelWidth: 800,
    pixelHeight: 1200,
    imageMotionBlur: 75,
    imageMotionMix: 80,
    photoEffects: { gloss: 20 },
    imageMotionMask: { shape: "scratch" },
  })
  expect(design.front[0].crop).toBeUndefined()
  expect(design.front[0].originalImage).toBeUndefined()
  expect(design.front[0].imageFilter).toBeUndefined()
  expect(close).toHaveBeenCalledOnce()
})
