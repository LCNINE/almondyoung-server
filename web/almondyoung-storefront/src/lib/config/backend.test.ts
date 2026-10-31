import { afterEach, describe, expect, it } from "vitest"
import { backendTenantHeaders } from "./backend"

describe("backendTenantHeaders", () => {
  const original = process.env.SERVED_TENANT_ID
  afterEach(() => {
    if (original === undefined) delete process.env.SERVED_TENANT_ID
    else process.env.SERVED_TENANT_ID = original
  })

  it("core 로 가는 요청은 쇼핑몰의 테넌트를 헤더로 싣는다", () => {
    process.env.SERVED_TENANT_ID = "1"
    for (const service of ["pim", "wms", "library"] as const) {
      expect(backendTenantHeaders(service)).toEqual({ "x-tenant-id": "1" })
    }
  })

  it("core 밖 서비스에는 싣지 않는다", () => {
    process.env.SERVED_TENANT_ID = "1"
    expect(backendTenantHeaders("medusa")).toEqual({})
    expect(backendTenantHeaders("users")).toEqual({})
  })

  it("테넌트가 없으면 싣지 않는다 — 기본 테넌트로 채우지 않는다", () => {
    delete process.env.SERVED_TENANT_ID
    expect(backendTenantHeaders("pim")).toEqual({})
  })
})
