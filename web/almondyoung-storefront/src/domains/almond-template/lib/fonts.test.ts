import { describe, expect, it, vi } from "vitest"
import {
  SANS_FONT,
  embeddedFontCss,
  fontStack,
  repairMaxZones,
  uploadedFontValue,
} from "./fonts"

const FAMILY = "AF0199a1b2c3d47e5f80718293a4b5c6d7"

describe("fontStack", () => {
  it("올린 글꼴은 그대로 두어 화면·인쇄가 같은 이름을 쓴다", () => {
    expect(fontStack(uploadedFontValue(FAMILY))).toBe(
      `'${FAMILY}', ${SANS_FONT}`
    )
  })

  it("형식이 다른 이름은 기본 고딕으로 바꾼다", () => {
    expect(fontStack(`'${FAMILY}x', ${SANS_FONT}`)).toBe(SANS_FONT)
    expect(fontStack(`'${FAMILY}'; } body { color: red`)).toBe(SANS_FONT)
  })
})

describe("repairMaxZones", () => {
  const MAXP_AT = 28

  const sfnt = (signature: number, maxpVersion: number, zones: number) => {
    const bytes = new ArrayBuffer(MAXP_AT + 32)
    const view = new DataView(bytes)
    view.setUint32(0, signature)
    view.setUint16(4, 1)
    view.setUint32(12, 0x6d617870)
    view.setUint32(20, MAXP_AT)
    view.setUint32(MAXP_AT, maxpVersion)
    view.setUint16(MAXP_AT + 14, zones)

    return bytes
  }
  const zones = (bytes: ArrayBuffer) =>
    new DataView(bytes).getUint16(MAXP_AT + 14)

  it("규격을 벗어난 maxZones 를 2 로 고친다", () => {
    const bytes = sfnt(0x00010000, 0x00010000, 4)

    repairMaxZones(bytes)

    expect(zones(bytes)).toBe(2)
  })

  it("정상 값과 다른 형식은 건드리지 않는다", () => {
    const normal = sfnt(0x00010000, 0x00010000, 2)
    const woff = sfnt(0x774f4646, 0x00010000, 4)
    const cff = sfnt(0x4f54544f, 0x00005000, 4)

    repairMaxZones(normal)
    repairMaxZones(woff)
    repairMaxZones(cff)

    expect([zones(normal), zones(woff), zones(cff)]).toEqual([2, 4, 4])
  })

  it("잘린 파일에서도 던지지 않는다", () => {
    expect(() => repairMaxZones(new ArrayBuffer(4))).not.toThrow()
    expect(() =>
      repairMaxZones(sfnt(0x00010000, 0x00010000, 4).slice(0, MAXP_AT))
    ).not.toThrow()
  })
})

describe("embeddedFontCss", () => {
  it("쓰인 글자만 요청하고 글꼴 파일을 data URL 로 넣는다", async () => {
    const requested: string[] = []
    vi.stubGlobal("fetch", async (url: string) => {
      requested.push(url)
      if (url.startsWith("https://fonts.googleapis.com"))
        return new Response(
          "@font-face{font-family:'Jua';src:url(https://fonts.gstatic.com/j.woff2) format('woff2')}"
        )
      return new Response(
        new Blob([new Uint8Array([1, 2, 3])], { type: "font/woff2" })
      )
    })

    const css = await embeddedFontCss(["Jua", "Jua", "Unknown"], "가가나")

    expect(requested[0]).toContain(
      `family=Jua&text=${encodeURIComponent("가나")}`
    )
    expect(css).toContain("url(data:font/woff2;base64,AQID)")
    expect(css).not.toContain("gstatic")
    vi.unstubAllGlobals()
  })

  it("글꼴을 못 받아도 던지지 않고 빈 문자열이다", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }))

    await expect(embeddedFontCss(["Jua"], "가")).resolves.toBe("")
    vi.unstubAllGlobals()
  })
})
