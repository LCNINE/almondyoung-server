import { describe, expect, it } from "vitest"
import {
  CATALOG_SEGMENT_ECHO_FIELD,
  CATALOG_SEGMENT_HEADER,
  CATALOG_SEGMENT_KEY_HEADER,
  CatalogSegmentMismatchError,
  assertSegmentApplied,
  buildSegmentHeaders,
  readAppliedSegment,
} from "./catalog-segment"

describe("buildSegmentHeaders", () => {
  it("세그먼트와 시크릿을 싣고 개인 토큰은 싣지 않는다", () => {
    expect(buildSegmentHeaders("mem", "secret")).toEqual({
      [CATALOG_SEGMENT_HEADER]: "mem",
      [CATALOG_SEGMENT_KEY_HEADER]: "secret",
    })
  })

  it("서로 다른 회원이라도 같은 헤더를 쓴다", () => {
    expect(buildSegmentHeaders("mem", "s")).toEqual(buildSegmentHeaders("mem", "s"))
  })

  it("회원과 비회원은 헤더가 갈린다", () => {
    expect(buildSegmentHeaders("mem", "s")).not.toEqual(
      buildSegmentHeaders("reg", "s")
    )
  })
})

describe("readAppliedSegment", () => {
  it("응답에 실린 적용 세그먼트를 읽는다", () => {
    expect(readAppliedSegment({ [CATALOG_SEGMENT_ECHO_FIELD]: "mem" })).toBe("mem")
    expect(readAppliedSegment({ [CATALOG_SEGMENT_ECHO_FIELD]: "reg" })).toBe("reg")
  })

  it("에코가 없거나 모르는 값이면 null", () => {
    expect(readAppliedSegment({ products: [] })).toBeNull()
    expect(readAppliedSegment({ [CATALOG_SEGMENT_ECHO_FIELD]: "vip" })).toBeNull()
    expect(readAppliedSegment(null)).toBeNull()
    expect(readAppliedSegment("mem")).toBeNull()
  })
})

describe("assertSegmentApplied", () => {
  it("주장과 적용이 같으면 통과한다", () => {
    expect(() =>
      assertSegmentApplied("mem", { [CATALOG_SEGMENT_ECHO_FIELD]: "mem" })
    ).not.toThrow()
  })

  it("에코가 없으면 적용된 게 아니라 실패한다", () => {
    // 세그먼트 미들웨어가 안 붙은 라우트나 옛 버전 Medusa 가 이 경우다.
    expect(() => assertSegmentApplied("mem", { products: [] })).toThrow(
      CatalogSegmentMismatchError
    )
  })

  it("mem 을 주장했는데 reg 가 적용되면 실패한다", () => {
    // 그룹 id 누락으로 회원 표시만 서고 가격은 비회원가인 반쪽 응답이 이 경로로 걸린다.
    expect(() =>
      assertSegmentApplied("mem", { [CATALOG_SEGMENT_ECHO_FIELD]: "reg" })
    ).toThrow(CatalogSegmentMismatchError)
  })

  it("reg 도 검증한다 — 비회원 응답이라고 넘겨짚지 않는다", () => {
    expect(() => assertSegmentApplied("reg", { products: [] })).toThrow(
      CatalogSegmentMismatchError
    )
  })

  it("진짜 장애와 구분되게 전용 타입으로 던진다", () => {
    try {
      assertSegmentApplied("mem", { [CATALOG_SEGMENT_ECHO_FIELD]: "reg" })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogSegmentMismatchError)
      expect((error as CatalogSegmentMismatchError).claimed).toBe("mem")
      expect((error as CatalogSegmentMismatchError).applied).toBe("reg")
    }
  })
})
