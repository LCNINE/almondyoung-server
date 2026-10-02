import { generateKeyPairSync, verify } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
import { BEAUTYTOP_ORIGIN, issueMemberToken, mintToken } from "./member-token"

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 })
const config = { privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), apiOrigin: "https://api.example.test" }
const member = async () => ({ status: "RECORDED" as const })
const req = (headers: Record<string, string> = {}) => new Request(BEAUTYTOP_ORIGIN + "/api/beautytop/token", { method: "POST", headers: { origin: BEAUTYTOP_ORIGIN, ...headers } })

describe("BeautyTop member proof", () => {
  beforeEach(() => vi.useRealTimers())
  it("signs a dedicated 120-second RSA token without exposing member identity", () => {
    const result = mintToken("member-fixture", config, 1_800_000_000)
    const [head, body, signature] = result.access_token.split(".")
    const payload = JSON.parse(Buffer.from(body, "base64url").toString())
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({ alg: "RS256", typ: "beautytop-access+jwt" })
    expect(verify("RSA-SHA256", new TextEncoder().encode(head + "." + body), keys.publicKey, new Uint8Array(Buffer.from(signature, "base64url")))).toBe(true)
    expect(payload.exp - payload.iat).toBe(120)
    expect(payload.sub).toMatch(/^[a-f0-9]{64}$/)
    expect(payload).not.toHaveProperty("email")
    expect(result.api_base_url).toBe(config.apiOrigin)
  })
  it("rejects cross-origin and unsigned users before signing", async () => {
    const getMemberId = vi.fn(async () => null)
    const getConfig = vi.fn(() => config)
    expect((await issueMemberToken(req({ origin: "https://evil.test" }), { getMemberId, getConfig, recordPremiumUsage: member })).status).toBe(403)
    expect(getMemberId).not.toHaveBeenCalled()
    expect((await issueMemberToken(req(), { getMemberId, getConfig, recordPremiumUsage: member })).status).toBe(401)
    expect(getConfig).not.toHaveBeenCalled()
  })
  it("requires same-origin fetch and no request body", async () => {
    const deps = { getMemberId: async () => "body-fixture", getConfig: () => config, recordPremiumUsage: member }
    expect((await issueMemberToken(req({ "sec-fetch-site": "same-site" }), deps)).status).toBe(403)
    const bodyReq = new Request(BEAUTYTOP_ORIGIN, { method: "POST", headers: { origin: BEAUTYTOP_ORIGIN }, body: "{}" })
    expect((await issueMemberToken(bodyReq, deps)).status).toBe(400)
    const emptyStream = new Request(BEAUTYTOP_ORIGIN, { method: "POST", headers: { origin: BEAUTYTOP_ORIGIN }, body: "" })
    expect((await issueMemberToken(emptyStream, deps)).status).toBe(200)
    let pulled = 0
    const endless = new ReadableStream({ pull(controller) { pulled++; controller.enqueue(new Uint8Array(1024)) } })
    const bigReq = new Request(BEAUTYTOP_ORIGIN, { method: "POST", headers: { origin: BEAUTYTOP_ORIGIN }, body: endless, duplex: "half" } as RequestInit)
    expect((await issueMemberToken(bigReq, deps)).status).toBe(400)
    expect(pulled).toBeLessThan(5)
    const chunks = [new Uint8Array(0), new TextEncoder().encode("{}")]
    const late = new ReadableStream({ pull(controller) { const next = chunks.shift(); if (next) controller.enqueue(next); else controller.close() } })
    const lateReq = new Request(BEAUTYTOP_ORIGIN, { method: "POST", headers: { origin: BEAUTYTOP_ORIGIN }, body: late, duplex: "half" } as RequestInit)
    expect((await issueMemberToken(lateReq, deps)).status).toBe(400)
    const hollow = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(0)) } })
    const hollowReq = new Request(BEAUTYTOP_ORIGIN, { method: "POST", headers: { origin: BEAUTYTOP_ORIGIN }, body: hollow, duplex: "half" } as RequestInit)
    expect((await issueMemberToken(hollowReq, deps)).status).toBe(400)
  })
  it("returns no-store, no CORS and generic errors without secrets", async () => {
    const response = await issueMemberToken(req(), { getMemberId: async () => "valid-fixture", getConfig: () => config, recordPremiumUsage: member })
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
    const broken = await issueMemberToken(req(), { getMemberId: async () => { throw new Error("private upstream details") }, getConfig: () => config, recordPremiumUsage: member })
    expect(await broken.text()).not.toContain("private upstream details")
    expect(broken.status).toBe(503)
  })
  it("issues tokens only after membership records the premium use", async () => {
    const getConfig = vi.fn(() => config)
    const notMember = await issueMemberToken(req(), { getMemberId: async () => "plain-fixture", getConfig, recordPremiumUsage: async () => ({ status: "NOT_MEMBER" as const }) })
    expect(notMember.status).toBe(403)
    expect(await notMember.json()).toEqual({ error: "MEMBERSHIP_REQUIRED" })
    const down = await issueMemberToken(req(), { getMemberId: async () => "down-fixture", getConfig, recordPremiumUsage: async () => { throw new Error("membership upstream details") } })
    expect(down.status).toBe(503)
    expect(await down.text()).not.toContain("membership upstream details")
    const unknown = await issueMemberToken(req(), { getMemberId: async () => "odd-fixture", getConfig, recordPremiumUsage: async () => ({ status: "SOMETHING_NEW" }) as never })
    expect(unknown.status).toBe(503)
    expect(await unknown.text()).not.toContain("access_token")
    const recordPremiumUsage = vi.fn(async () => ({ status: "RECORDED" as const }))
    const anonymous = await issueMemberToken(req(), { getMemberId: async () => null, getConfig, recordPremiumUsage })
    expect(anonymous.status).toBe(401)
    expect(recordPremiumUsage).not.toHaveBeenCalled()
    expect((await issueMemberToken(req(), { getMemberId: async () => "active-fixture", getConfig, recordPremiumUsage: async () => ({ status: "ALREADY_RECORDED" as const }) })).status).toBe(200)
  })
  it("asks for the withdrawal confirmation instead of recording, and passes only the fixed acknowledgement", async () => {
    const recordPremiumUsage = vi.fn(async (acknowledged: boolean) => (acknowledged ? { status: "RECORDED" as const } : { status: "CONFIRMATION_REQUIRED" as const, withdrawalDaysRemaining: 5 }))
    const deps = { getMemberId: async () => "window-fixture", getConfig: () => config, recordPremiumUsage }
    const ask = await issueMemberToken(req(), deps)
    expect(ask.status).toBe(409)
    expect(await ask.json()).toEqual({ error: "WITHDRAWAL_CONFIRMATION_REQUIRED", withdrawalDaysRemaining: 5 })
    const ackReq = new Request(BEAUTYTOP_ORIGIN + "/api/beautytop/token?acknowledged=1", { method: "POST", headers: { origin: BEAUTYTOP_ORIGIN } })
    expect((await issueMemberToken(ackReq, deps)).status).toBe(200)
    expect(recordPremiumUsage.mock.calls).toEqual([[false], [true]])
    for (const query of ["?acknowledged=true", "?acknowledged=1&x=1", "?x=1"]) {
      const bad = new Request(BEAUTYTOP_ORIGIN + "/api/beautytop/token" + query, { method: "POST", headers: { origin: BEAUTYTOP_ORIGIN } })
      expect((await issueMemberToken(bad, deps)).status).toBe(400)
    }
    expect(recordPremiumUsage).toHaveBeenCalledTimes(2)
  })
  it("does not record a use when the signing key is broken", async () => {
    const recordPremiumUsage = vi.fn(async () => ({ status: "RECORDED" as const }))
    const broken = await issueMemberToken(req(), { getMemberId: async () => "key-fixture", getConfig: () => ({ ...config, privateKey: "" }), recordPremiumUsage })
    expect(broken.status).toBe(503)
    expect(recordPremiumUsage).not.toHaveBeenCalled()
  })
  it("rejects weak keys and insecure API origins", () => {
    for (const apiOrigin of ["http://127.0.0.1:8765", "https://user:pass@api.example.test", "https://api.example.test/path"]) {
      expect(() => mintToken("fixture", { ...config, apiOrigin })).toThrow()
    }
    const weak = generateKeyPairSync("rsa", { modulusLength: 1024 })
    expect(() => mintToken("fixture", { ...config, privateKey: weak.privateKey.export({ type: "pkcs8", format: "pem" }).toString() })).toThrow()
  })
  it("limits repeated token issuance for the same member", async () => {
    const deps = { getMemberId: async () => "rate-fixture", getConfig: () => config, recordPremiumUsage: member }
    for (let i = 0; i < 60; i++) expect((await issueMemberToken(req(), deps)).status).toBe(200)
    const limited = await issueMemberToken(req(), deps)
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("60")
  })
})
