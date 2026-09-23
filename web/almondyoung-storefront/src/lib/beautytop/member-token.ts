import "server-only"

import { createHash, createPrivateKey, randomUUID, sign } from "node:crypto"

export const BEAUTYTOP_ORIGIN = "https://www.almondyoung.com"
const TTL_SECONDS = 120
const headers = {
  "Cache-Control": "private, no-store",
  "Vary": "Origin",
  "X-Content-Type-Options": "nosniff",
}

type Config = { privateKey: string; apiOrigin: string }
type Dependencies = {
  getMemberId: () => Promise<string | null>
  getConfig: () => Config
}

function reply(status: number, data: unknown) {
  return Response.json(data, { status, headers })
}

// This is a process-local guard. Production ingress must also limit the route.
const windows = new Map<string, { since: number; count: number }>()
function allowed(subject: string) {
  const now = Date.now()
  for (const [key, entry] of windows) {
    if (now - entry.since >= 60_000) windows.delete(key)
  }
  const entry = windows.get(subject) ?? { since: now, count: 0 }
  if (entry.count >= 10 || (!windows.has(subject) && windows.size >= 4096)) return false
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
  const signature = sign("RSA-SHA256", Buffer.from(message), key).toString("base64url")
  return { access_token: message + "." + signature, token_type: "Bearer", expires_in: TTL_SECONDS, api_base_url: origin.origin }
}

export async function issueMemberToken(request: Request, deps: Dependencies) {
  if (request.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" })
  const site = request.headers.get("sec-fetch-site")
  if (request.headers.get("origin") !== BEAUTYTOP_ORIGIN || (site && site !== "same-origin")) {
    return reply(403, { error: "ORIGIN_NOT_ALLOWED" })
  }
  if (request.body || new URL(request.url).search) return reply(400, { error: "BODY_NOT_ALLOWED" })
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
  try {
    return reply(200, mintToken(member, deps.getConfig()))
  } catch {
    // Do not log upstream bodies, cookies, signing keys or access tokens.
    return reply(503, { error: "BEAUTYTOP_NOT_CONFIGURED" })
  }
}
