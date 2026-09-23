import { generateKeyPairSync, verify } from "node:crypto"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
import { BEAUTYTOP_ORIGIN, issueMemberToken, mintToken } from "./member-token"

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 })
const config = { privateKey: keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(), apiOrigin: "https://api.example.test" }
const req = (headers: Record<string, string> = {}) => new Request(BEAUTYTOP_ORIGIN + "/api/beautytop/token", { method: "POST", headers: { origin: BEAUTYTOP_ORIGIN, ...headers } })

describe("BeautyTop member proof", () => {
  beforeEach(() => vi.useRealTimers())
  it("signs a dedicated 120-second RSA token without exposing member identity", () => {
    const result = mintToken("member-fixture", config, 1_800_000_000)
    const [head, body, signature] = result.access_token.split(".")
    const payload = JSON.parse(Buffer.from(body, "base64url").toString())
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({ alg: "RS256", typ: "beautytop-access+jwt" })
    expect(verify("RSA-SHA256", Buffer.from(head + "." + body), keys.publicKey, Buffer.from(signature, "base64url"))).toBe(true)
    expect(payload.exp - payload.iat).toBe(120)
    expect(payload.sub).toMatch(/^[a-f0-9]{64}$/)
    expect(payload).not.toHaveProperty("email")
    expect(result.api_base_url).toBe(config.apiOrigin)
  })
  it("rejects cross-origin and unsigned users before signing", async () => {
    const getMemberId = vi.fn(async () => null)
    const getConfig = vi.fn(() => config)
    expect((await issueMemberToken(req({ origin: "https://evil.test" }), { getMemberId, getConfig })).status).toBe(403)
    expect(getMemberId).not.toHaveBeenCalled()
    expect((await issueMemberToken(req(), { getMemberId, getConfig })).status).toBe(401)
    expect(getConfig).not.toHaveBeenCalled()
  })
  it("requires same-origin fetch and no request body", async () => {
    const deps = { getMemberId: async () => "body-fixture", getConfig: () => config }
    expect((await issueMemberToken(req({ "sec-fetch-site": "same-site" }), deps)).status).toBe(403)
    const bodyReq = new Request(BEAUTYTOP_ORIGIN, { method: "POST", headers: { origin: BEAUTYTOP_ORIGIN }, body: "{}" })
    expect((await issueMemberToken(bodyReq, deps)).status).toBe(400)
  })
  it("returns no-store, no CORS and generic errors without secrets", async () => {
    const response = await issueMemberToken(req(), { getMemberId: async () => "valid-fixture", getConfig: () => config })
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
    const broken = await issueMemberToken(req(), { getMemberId: async () => { throw new Error("private upstream details") }, getConfig: () => config })
    expect(await broken.text()).not.toContain("private upstream details")
    expect(broken.status).toBe(503)
  })
  it("rejects weak keys and insecure API origins", () => {
    for (const apiOrigin of ["http://127.0.0.1:8765", "https://user:pass@api.example.test", "https://api.example.test/path"]) {
      expect(() => mintToken("fixture", { ...config, apiOrigin })).toThrow()
    }
    const weak = generateKeyPairSync("rsa", { modulusLength: 1024 })
    expect(() => mintToken("fixture", { ...config, privateKey: weak.privateKey.export({ type: "pkcs8", format: "pem" }).toString() })).toThrow()
  })
  it("limits repeated token issuance for the same member", async () => {
    const deps = { getMemberId: async () => "rate-fixture", getConfig: () => config }
    for (let i = 0; i < 10; i++) expect((await issueMemberToken(req(), deps)).status).toBe(200)
    const limited = await issueMemberToken(req(), deps)
    expect(limited.status).toBe(429)
    expect(limited.headers.get("retry-after")).toBe("60")
  })
})
