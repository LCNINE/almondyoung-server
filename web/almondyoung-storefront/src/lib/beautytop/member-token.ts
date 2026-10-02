import "server-only"

import { createHash, createPrivateKey, randomUUID, sign } from "node:crypto"

export const BEAUTYTOP_ORIGIN = "https://almondyoung.com"
const TTL_SECONDS = 120
const headers = {
  "Cache-Control": "private, no-store",
  "Vary": "Origin",
  "X-Content-Type-Options": "nosniff",
}

type Config = { privateKey: string; apiOrigin: string }
export type PremiumUsageStatus = "RECORDED" | "ALREADY_RECORDED" | "CONFIRMATION_REQUIRED" | "NOT_MEMBER"
export type PremiumUsage = { status: PremiumUsageStatus; withdrawalDaysRemaining?: number }
type Dependencies = {
  getMemberId: () => Promise<string | null>
  // Opening premium data is a membership benefit use. Recording it is the gate, so a token never exists without the record.
  recordPremiumUsage: (acknowledged: boolean) => Promise<PremiumUsage>
  getConfig: () => Config
}

// The only query accepted: the member agreed that opening ends the 7-day full-refund window.
const ACKNOWLEDGED_QUERY = "?acknowledged=1"

function reply(status: number, data: unknown) {
  return Response.json(data, { status, headers })
}

// This is a process-local guard. Production ingress must also limit the route.
const windows = new Map<string, { since: number; count: number }>()
function allowed(subject: string) {
  const now = Date.now()
  windows.forEach((entry, key) => {
    if (now - entry.since >= 60_000) windows.delete(key)
  })
  const entry = windows.get(subject) ?? { since: now, count: 0 }
  if (entry.count >= 60 || (!windows.has(subject) && windows.size >= 4096)) return false
  entry.count++
  windows.set(subject, entry)
  return true
}

export function mintToken(memberId: string, config: Config, now = Math.floor(Date.now() / 1000)) {
  if (!memberId || memberId.length > 200) throw new Error("Invalid member")
  const origin = new URL(config.apiOrigin)
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw new Error("HTTPS API origin required")
  }
  const key = createPrivateKey(config.privateKey.replace(/\\n/g, "\n"))
  if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) {
    throw new Error("Dedicated RSA key required")
  }
  const payload = {
    iss: BEAUTYTOP_ORIGIN,
    aud: "beautytop-api",
    sub: createHash("sha256").update("beautytop:" + memberId).digest("hex"),
    iat: now,
    exp: now + TTL_SECONDS,
    scope: "beautytop:read",
    jti: randomUUID(),
  }
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")
  const message = encode({ alg: "RS256", typ: "beautytop-access+jwt" }) + "." + encode(payload)
  const signature = sign("RSA-SHA256", new TextEncoder().encode(message), key).toString("base64url")
  return { access_token: message + "." + signature, token_type: "Bearer", expires_in: TTL_SECONDS, api_base_url: origin.origin }
}

async function hasBody(request: Request) {
  const reader = request.body?.getReader()
  if (!reader) return false
  try {
    for (let i = 0; i < 16; i++) {
      const { done, value } = await reader.read()
      if (done) return false
      if (value && value.length > 0) return true
    }
    return true
  } finally {
    await reader.cancel()
  }
}

export async function issueMemberToken(request: Request, deps: Dependencies) {
  if (request.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" })
  const site = request.headers.get("sec-fetch-site")
  const allowedOrigin = process.env.NODE_ENV === "production" ? BEAUTYTOP_ORIGIN : new URL(request.url).origin
  if (request.headers.get("origin") !== allowedOrigin || (site && site !== "same-origin")) {
    return reply(403, { error: "ORIGIN_NOT_ALLOWED" })
  }
  const search = new URL(request.url).search
  if ((await hasBody(request)) || (search && search !== ACKNOWLEDGED_QUERY)) return reply(400, { error: "BODY_NOT_ALLOWED" })
  let member: string | null
  try {
    member = await deps.getMemberId()
  } catch {
    return reply(503, { error: "LOGIN_SERVICE_UNAVAILABLE" })
  }
  if (!member) return reply(401, { error: "LOGIN_REQUIRED" })
  const subject = createHash("sha256").update("beautytop:" + member).digest("hex")
  if (!allowed(subject)) {
    const response = reply(429, { error: "RATE_LIMITED" })
    response.headers.set("Retry-After", "60")
    return response
  }
  // Sign before recording: a broken key must not leave a usage record for data the member never received.
  let token: ReturnType<typeof mintToken>
  try {
    token = mintToken(member, deps.getConfig())
  } catch {
    // Do not log upstream bodies, cookies, signing keys or access tokens.
    return reply(503, { error: "BEAUTYTOP_NOT_CONFIGURED" })
  }
  let usage: PremiumUsage
  try {
    usage = await deps.recordPremiumUsage(search === ACKNOWLEDGED_QUERY)
  } catch {
    return reply(503, { error: "MEMBERSHIP_SERVICE_UNAVAILABLE" })
  }
  if (usage.status === "NOT_MEMBER") return reply(403, { error: "MEMBERSHIP_REQUIRED" })
  if (usage.status === "CONFIRMATION_REQUIRED") {
    const days = usage.withdrawalDaysRemaining
    return reply(409, {
      error: "WITHDRAWAL_CONFIRMATION_REQUIRED",
      withdrawalDaysRemaining: typeof days === "number" && Number.isInteger(days) && days >= 0 && days <= 7 ? days : null,
    })
  }
  if (usage.status !== "RECORDED" && usage.status !== "ALREADY_RECORDED") return reply(503, { error: "MEMBERSHIP_SERVICE_UNAVAILABLE" })
  return reply(200, token)
}
