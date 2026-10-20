import { describe, expect, it } from "vitest"
import { newDesign, parseDesign, updateLayer } from "./document"
import { makeLayer } from "./layer"
import { printSvg } from "../components/print-svg"

const photo = "data:image/png;base64,iVBORw0KGgo="
function sample() {
  const design = newDesign("card")
  design.front = [
    {
      ...makeLayer("image", design),
      id: "photo",
      image: photo,
      x: 5,
      y: 5,
      width: 60,
      height: 30,
      imageMotionBlur: 40,
      imageMotionMix: 65,
    },
    { ...makeLayer("text", design), id: "title", text: "Salon" },
  ]
  return design
}
describe("photo motion effect", () => {
  it("preserves settings through save, load and photo replacement", () => {
    const loaded = parseDesign(JSON.parse(JSON.stringify(sample())))
    const replaced = updateLayer(loaded, "front", "photo", {
      image: "data:image/png;base64,YWJj",
      pixelWidth: 1200,
      pixelHeight: 1600,
    })
    expect(replaced.front[0]).toMatchObject({
      image: "data:image/png;base64,YWJj",
      imageMotionBlur: 40,
      imageMotionMix: 65,
    })
    expect(parseDesign(JSON.parse(JSON.stringify(replaced)))).toEqual(replaced)
  })
  it.each([-1, 101, NaN, Infinity, "40", null])(
    "rejects invalid values: %s",
    (value) => {
      for (const key of ["imageMotionBlur", "imageMotionMix"] as const) {
        const design = sample()
        Object.assign(design.front[0], { [key]: value })
        expect(() => parseDesign(design)).toThrow()
      }
    }
  )
  it("exports horizontal blur separately from text", async () => {
    const svg = await printSvg(sample(), "front", 0)
    expect(svg).toContain('stdDeviation="1.2 0"')
    expect(svg).toContain('k2="0.65" k3="0.35"')
    expect(svg).toContain('clip-path="url(#clip-photo)"')
    expect(svg).toContain('filter="url(#motion-photo)"')
    expect(svg).not.toContain("motion-title")
    expect(svg).toContain("Salon")
    expect(svg).toContain(photo)
  })
  it("bypasses the filter when strength or mix is zero", async () => {
    for (const key of ["imageMotionBlur", "imageMotionMix"] as const) {
      const design = sample()
      design.front[0][key] = 0
      expect(await printSvg(design, "front", 0)).not.toContain("feGaussianBlur")
    }
  })
  it("keeps old documents without an effect unchanged", async () => {
    const design = sample()
    delete design.front[0].imageMotionBlur
    delete design.front[0].imageMotionMix
    expect(parseDesign(design)).toEqual(design)
    expect(await printSvg(design, "front", 0)).not.toContain("feGaussianBlur")
  })
})

it("saves regional masks and layered photo effects", async () => {
  const design = sample()
  design.front[0].imageMotionMask = {
    shape: "scratch",
    x: 10,
    y: 20,
    width: 70,
    height: 40,
  }
  design.front[0].photoEffects = { softFocus: 20, gloss: 30, grain: 10 }
  const loaded = parseDesign(JSON.parse(JSON.stringify(design)))
  expect(loaded.front[0].imageMotionMask).toEqual(
    design.front[0].imageMotionMask
  )
  const svg = await printSvg(loaded, "front", 0)
  expect(svg).toContain('mask="url(#motion-mask-photo)"')
  expect(svg).toContain("photo-fx-photo-gloss")
  expect(svg).toContain("photo-fx-photo-grain")
})

it("rejects invalid mask dimensions and unknown photo effects", () => {
  const design = sample()
  design.front[0].imageMotionMask = {
    shape: "scratch",
    x: 0,
    y: 0,
    width: 0,
    height: 20,
  }
  expect(() => parseDesign(design)).toThrow()
  delete design.front[0].imageMotionMask
  Object.assign(design.front[0], { photoEffects: { unsupported: 20 } })
  expect(() => parseDesign(design)).toThrow()
})
