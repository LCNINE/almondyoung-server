import "server-only"

import { cookies } from "next/headers"

import { env } from "./env"
import { decodeJwtPayload, isExpired } from "./jwt"

/**
 * 계정 허브 쿠키 구조 (auth-web 자체 도메인에만 저장).
 *
 * - ay_accounts: 계정 순서 리스트 (JSON 배열). 메타데이터 전체는 크기 문제로 분리.
 * - ay_acct_<userId>: { email, nickname, username } JSON. 표시용.
 * - ay_acct_<userId>_rt: refresh token (JWT). HttpOnly.
 *
 * 모두 domain 속성을 지정하지 않음 → 정확히 auth-web host에만 바인딩 (parent로 새지 않음).
 */

const LIST_COOKIE = "ay_accounts"
const META_PREFIX = "ay_acct_"
const RT_SUFFIX = "_rt"

const LIST_MAX_AGE = 60 * 60 * 24 * 365 // 1 year
const RT_MAX_AGE = 60 * 60 * 24 * 90 // 90 days

export type AccountMeta = {
  userId: string
  loginId: string
  email: string
  nickname: string
  username: string
}

export type StoredAccount = AccountMeta & {
  hasValidRefreshToken: boolean
  refreshTokenExp?: number
}

function metaCookieName(userId: string): string {
  return `${META_PREFIX}${userId}`
}

function rtCookieName(userId: string): string {
  return `${META_PREFIX}${userId}${RT_SUFFIX}`
}

export async function listAccounts(): Promise<StoredAccount[]> {
  const jar = await cookies()
  const raw = jar.get(LIST_COOKIE)?.value
  if (!raw) return []
  let ids: string[]
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    ids = parsed.filter((v): v is string => typeof v === "string")
  } catch {
    return []
  }

  const out: StoredAccount[] = []
  for (const id of ids) {
    const metaRaw = jar.get(metaCookieName(id))?.value
    if (!metaRaw) continue
    let meta: AccountMeta
    try {
      const parsed = JSON.parse(metaRaw)
      // loginId 는 이번 변경 이전에 저장된 메타 쿠키엔 없을 수 있다. 누락된 경우 빈 문자열로 두고,
      // 호출부 (selectAccountAction 등) 가 비어 있으면 prefill 없이 일반 /signin 으로 보내도록 한다.
      meta = {
        userId: id,
        loginId: typeof parsed?.loginId === "string" ? parsed.loginId : "",
        email: typeof parsed?.email === "string" ? parsed.email : "",
        nickname: typeof parsed?.nickname === "string" ? parsed.nickname : "",
        username: typeof parsed?.username === "string" ? parsed.username : "",
      }
    } catch {
      continue
    }
    const rt = jar.get(rtCookieName(id))?.value
    const payload = rt ? decodeJwtPayload(rt) : null
    const exp = payload?.exp
    out.push({
      ...meta,
      hasValidRefreshToken: !!rt && !isExpired(exp),
      refreshTokenExp: exp,
    })
  }
  return out
}

/**
 * userId 로 메타 쿠키만 조회한다. 재인증 흐름이 prefill 용 loginId/email 만 필요할 때 사용.
 */
export async function getAccountMeta(
  userId: string
): Promise<AccountMeta | null> {
  const jar = await cookies()
  const metaRaw = jar.get(metaCookieName(userId))?.value
  if (!metaRaw) return null
  try {
    const parsed = JSON.parse(metaRaw)
    return {
      userId,
      loginId: typeof parsed?.loginId === "string" ? parsed.loginId : "",
      email: typeof parsed?.email === "string" ? parsed.email : "",
      nickname: typeof parsed?.nickname === "string" ? parsed.nickname : "",
      username: typeof parsed?.username === "string" ? parsed.username : "",
    }
  } catch {
    return null
  }
}

export async function getRefreshToken(userId: string): Promise<string | null> {
  const jar = await cookies()
  return jar.get(rtCookieName(userId))?.value ?? null
}

// upsertAccount 함수는 쿠키 (ay_acct_*) — auth-web 자기 도메인에만 바인딩목적임
// - 계정 전환 UI ("이 브라우저에 로그인했던 계정들 목록")
// - 재인증 시 loginId/email prefill
// - refresh token 유효 여부 표시 (로그인 선택 화면에서 만료 여부 뱃지)
export async function upsertAccount(
  meta: AccountMeta,
  refreshToken: string
): Promise<void> {
  const jar = await cookies()
  const listRaw = jar.get(LIST_COOKIE)?.value
  let ids: string[] = []
  if (listRaw) {
    try {
      const parsed = JSON.parse(listRaw)
      if (Array.isArray(parsed)) {
        ids = parsed.filter((v): v is string => typeof v === "string")
      }
    } catch {
      // reset
    }
  }
  if (!ids.includes(meta.userId)) ids.push(meta.userId)

  const common = {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax" as const,
    path: "/",
  }

  jar.set(LIST_COOKIE, JSON.stringify(ids), { ...common, maxAge: LIST_MAX_AGE })
  jar.set(
    metaCookieName(meta.userId),
    JSON.stringify({
      loginId: meta.loginId,
      email: meta.email,
      nickname: meta.nickname,
      username: meta.username,
    }),
    { ...common, maxAge: LIST_MAX_AGE }
  )
  jar.set(rtCookieName(meta.userId), refreshToken, {
    ...common,
    maxAge: RT_MAX_AGE,
  })
}

/**
 * 로그아웃 시 호출. 해당 계정의 refresh token 쿠키(_rt)만 삭제하고 메타/리스트는 남겨둔다.
 * → 계정은 허브 리스트에 "재로그인 필요" 상태로 계속 보이고, 다시 선택하면 selectAccountAction 이
 *    RT 부재를 감지해 비밀번호 재입력(/signin reauth) 으로 보낸다. 공용 PC 보안 흐름의 핵심.
 * removeAccount 와 달리 메타를 지우지 않으므로 loginId/email prefill 도 유지된다.
 */
export async function invalidateAccountRefreshToken(
  userId: string
): Promise<void> {
  const jar = await cookies()
  jar.delete(rtCookieName(userId))
}

export async function removeAccount(userId: string): Promise<void> {
  const jar = await cookies()
  const listRaw = jar.get(LIST_COOKIE)?.value
  let ids: string[] = []
  if (listRaw) {
    try {
      const parsed = JSON.parse(listRaw)
      if (Array.isArray(parsed)) {
        ids = parsed.filter(
          (v): v is string => typeof v === "string" && v !== userId
        )
      }
    } catch {
      ids = []
    }
  }
  const common = {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax" as const,
    path: "/",
  }
  jar.set(LIST_COOKIE, JSON.stringify(ids), { ...common, maxAge: LIST_MAX_AGE })
  jar.delete(metaCookieName(userId))
  jar.delete(rtCookieName(userId))
}
