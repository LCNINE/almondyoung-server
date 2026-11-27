import { createHash } from "node:crypto"

type Claims = { sub?: string; actor_id?: string; iat?: number }

const decodeClaims = (jwt: string): Claims | null => {
  try {
    return JSON.parse(
      Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")
    ) as Claims
  } catch {
    return null
  }
}

const fingerprint = (value: string) =>
  value ? createHash("sha256").update(value).digest("hex").slice(0, 8) : "empty"

const describeJwt = (value: string, owner: (claims: Claims) => string | undefined) => {
  const claims = decodeClaims(value)

  return claims ? `${owner(claims) ?? "-"}@${claims.iat ?? "-"}` : fingerprint(value)
}

/**
 * 브라우저가 보낸 로그인 쿠키를 값 없이 요약한다 — 같은 이름이 몇 개 왔는지, 누구의 언제 발급분인지.
 * 로그 키에 token·cookie 를 넣으면 로거가 값을 가리므로 sent_* 로 짓는다.
 */
export const describeSentSession = (cookieHeader: string | null) => {
  const pairs = (cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf("=")

      return [part.slice(0, at), part.slice(at + 1)] as const
    })
  const valuesOf = (name: string) =>
    pairs.filter(([key]) => key === name).map(([, value]) => value)

  return {
    sent_count: pairs.length,
    sent_bytes: cookieHeader?.length ?? 0,
    sent_access: valuesOf("accessToken")
      .map((value) => describeJwt(value, (claims) => claims.sub))
      .join(","),
    sent_refresh: valuesOf("refreshToken").map(fingerprint).join(","),
    sent_medusa: valuesOf("_medusa_jwt")
      .map((value) => describeJwt(value, (claims) => claims.actor_id))
      .join(","),
    sent_cache_id: valuesOf("_medusa_cache_id").length,
  }
}

export const describeIssuedAccess = (jwt: string) =>
  describeJwt(jwt, (claims) => claims.sub)
