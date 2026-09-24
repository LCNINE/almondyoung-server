import { describe, expect, it } from "vitest"
import { MAX_EDGE, isCompressible, scaledSize } from "./image-compress"

// admin-web 쪽(apps/admin-web/src/lib/utils/image-compress.spec.ts)의 순수 함수 커버리지를
// 최소로 옮겨온다. compressImageForUpload 는 canvas/createImageBitmap 이 필요해 여기선 제외한다.

describe("isCompressible", () => {
  it("일반 이미지는 변환할 수 있다", () => {
    expect(isCompressible("image/jpeg")).toBe(true)
    expect(isCompressible("image/png")).toBe(true)
    expect(isCompressible("image/webp")).toBe(true)
  })

  it("GIF 와 SVG 는 건드리지 않는다", () => {
    expect(isCompressible("image/gif")).toBe(false)
    expect(isCompressible("image/svg+xml")).toBe(false)
  })

  it("이미지가 아니면 대상이 아니다", () => {
    expect(isCompressible("application/pdf")).toBe(false)
  })
})

describe("scaledSize", () => {
  it("비율을 유지하며 긴 변을 맞춘다", () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: MAX_EDGE, height: 1200 })
    expect(scaledSize(3000, 4000)).toEqual({ width: 1200, height: MAX_EDGE })
  })

  it("이미 작은 이미지는 확대하지 않는다", () => {
    expect(scaledSize(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it("아주 납작한 이미지도 최소 1px 은 남긴다", () => {
    expect(scaledSize(8000, 1).height).toBe(1)
  })
})
