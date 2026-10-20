import { expect, it } from "vitest"
import { EFFECT_LAYERS } from "./effect-layer"
import { newDesign, parseDesign } from "./document"
import { makeLayer } from "./layer"
import { printSvg } from "../components/print-svg"

it.each(EFFECT_LAYERS)(
  "saves and prints the %s overlay independently",
  async (kind, name, _group, fill) => {
    const design = newDesign("card")
    design.front = [
      {
        ...makeLayer("effect", design),
        effectKind: kind,
        name,
        fill,
        rotation: 25,
        opacity: 0.4,
      },
    ]
    const loaded = parseDesign(JSON.parse(JSON.stringify(design)))
    expect(loaded.front).toEqual(design.front)
    const svg = await printSvg(loaded, "front", 0)
    expect(svg).toContain("rotate(25)")
    expect(svg).toContain('opacity="0.4"')
    expect(svg).not.toContain("<image")
  }
)
it("rejects an unsupported effect layer", () => {
  const design = newDesign("card")
  design.front = [makeLayer("effect", design)]
  expect(() => parseDesign(design)).toThrow()
})
