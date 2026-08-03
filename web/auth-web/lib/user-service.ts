import "server-only"

import { env } from "./env"
import { readApiData, readJson, throwIfBad } from "./api-helpers"

type SignInBody = { loginId: string; password: string; rememberMe?: boolean }

export type TokenPair = { accessToken: string; refreshToken: string }

export type SendPhoneVerificationInput = {
  countryCode: string
  phoneNumber: string
  purpose?: "phone_verify"
}

export type VerifyPhoneCodeInput = {
  phoneNumber: string
  code: string
}

export type FindUserIdInput = {
  phoneNumber: string
}

export type ForgotPasswordInput = {
  loginId: string
  phoneNumber: string
}

export type ResetPasswordInput = {
  token: string
  password: string
}

export type SendPhoneVerificationResult = {
  success: boolean
  message: string
}

export type PhoneVerificationResult = {
  success: boolean
  message: string
}

export type FindUserIdResult = {
  loginIds: string[]
}

export type ForgotPasswordResult = {
  verificationToken: string
}

export type ResetPasswordResult = void

export type UserProfile = {
  id: string
  loginId: string
  username: string
  email: string
  isEmailVerified: boolean
}

export async function signIn(body: SignInBody): Promise<TokenPair> {
  const res = await fetch(`${env.userServiceUrl}/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "signin")
  return readApiData<TokenPair>(res)
}

export type LocalSignUpInput = {
  loginId: string
  password: string
  email: string
  username: string
  nickname: string
  birthday: string
  phoneNumber: string
  isOver14: boolean
  termsOfService: boolean
  electronicTransaction: boolean
  privacyPolicy: boolean
  thirdPartySharing: boolean
  marketingConsent: boolean
}

export async function signUp(
  body: LocalSignUpInput
): Promise<{ userId: string; signupToken: string; message: string }> {
  const res = await fetch(`${env.userServiceUrl}/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "signup")
  return readApiData<{ userId: string; signupToken: string; message: string }>(
    res
  )
}

export async function callbackSignup(signupToken: string): Promise<TokenPair> {
  const res = await fetch(`${env.userServiceUrl}/auth/callback/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signupToken }),
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "callback-signup")
  return readApiData<TokenPair>(res)
}

export async function sendPhoneVerificationCode(
  body: SendPhoneVerificationInput
): Promise<SendPhoneVerificationResult> {
  const res = await fetch(`${env.userServiceUrl}/twilio/send-message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, purpose: body.purpose ?? "phone_verify" }),
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "send-phone-verification")
  const message = await readApiData<string>(res)
  return { success: true, message }
}

export async function verifyPhoneCode(
  body: VerifyPhoneCodeInput
): Promise<PhoneVerificationResult> {
  const res = await fetch(`${env.userServiceUrl}/twilio/verify-code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "verify-phone-code")
  const message = await readApiData<string>(res)
  return { success: true, message }
}

export async function findUserId(
  body: FindUserIdInput
): Promise<FindUserIdResult> {
  const res = await fetch(`${env.userServiceUrl}/auth/forget-userid`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "find-user-id")
  return readApiData<FindUserIdResult>(res)
}

export async function forgotPassword(
  body: ForgotPasswordInput
): Promise<ForgotPasswordResult> {
  const res = await fetch(`${env.userServiceUrl}/auth/forget-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "forgot-password")
  return readApiData<ForgotPasswordResult>(res)
}

export async function resetPassword(
  body: ResetPasswordInput
): Promise<ResetPasswordResult> {
  const res = await fetch(`${env.userServiceUrl}/auth/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "reset-password")
  return readApiData<ResetPasswordResult>(res)
}

/**
 * `/auth/restore-token` 응답을 분기 가능한 결과로 반환한다.
 *
 * - 401 은 stale refresh token (DB row 가 다른 클라이언트 재로그인으로 overwrite 됐거나, logout 으로
 *   삭제됐거나, 자연 만료된 경우 모두 포함). 호출부는 비밀번호 재인증 흐름으로 분기해야 한다.
 * - 그 외 non-ok 는 진짜 서버 오류로 간주해 메시지를 그대로 노출.
 *
 * 다른 user-service 호출은 `throwIfBad` 가 status 를 메시지에 박아 던지지만, 여기는 호출부가 401 을
 * 의미적으로 분기해야 하므로 throw 대신 union 결과를 반환한다.
 */
export type RestoreResult =
  | { ok: true; accessToken: string }
  | { ok: false; reauthRequired: true }
  | { ok: false; reauthRequired: false; message: string }

export async function restoreAccessToken(
  refreshToken: string
): Promise<RestoreResult> {
  const res = await fetch(`${env.userServiceUrl}/auth/restore-token`, {
    method: "POST",
    headers: { cookie: `refreshToken=${refreshToken}` },
    cache: "no-store",
    redirect: "manual",
  })

  if (res.status === 401) {
    return { ok: false, reauthRequired: true }
  }

  if (!res.ok) {
    const text = await res.text()
    let message = text
    try {
      const body = JSON.parse(text)
      message = body?.message ?? text
      if (Array.isArray(message)) message = message.join(", ")
    } catch {
      // keep raw
    }
    return {
      ok: false,
      reauthRequired: false,
      message: `[restore-token] ${res.status}: ${message}`,
    }
  }

  const body = await readApiData<{ accessToken?: string }>(res)
  if (body.accessToken) return { ok: true, accessToken: body.accessToken }

  // Fallback: older behavior sets accessToken as Set-Cookie only
  const setCookie = res.headers.get("set-cookie") ?? ""
  const m = setCookie.match(/accessToken=([^;]+)/)
  if (m?.[1]) return { ok: true, accessToken: m[1] }

  return {
    ok: false,
    reauthRequired: false,
    message: "[restore-token] accessToken missing in response",
  }
}

export type IssueOAuthCodeInput = {
  clientId: string
  userId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: "S256"
  scope?: string
  nonce?: string
}

export async function issueOAuthCodeInternal(
  input: IssueOAuthCodeInput
): Promise<{ code: string; expiresIn: number }> {
  if (!env.oauthInternalSecret) {
    throw new Error("OAUTH_INTERNAL_SECRET not configured on auth-web")
  }
  const res = await fetch(`${env.userServiceUrl}/oauth/internal/issue-code`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": env.oauthInternalSecret,
    },
    body: JSON.stringify(input),
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "issue-code")
  // user-service OAuthController 는 @SkipResponseEnvelope() 라 envelope 없이 직접 반환한다.
  // readApiData 를 쓰면 body.data 가 undefined 라서 호출부 destructure 가 폭발한다.
  return readJson<{ code: string; expiresIn: number }>(res)
}

/**
 * `/oauth/authorize` 처리 직후, redirect_uri 가 client 등록 화이트리스트와 매칭되는지 user-service 에 위임 검증.
 * 미등록인 경우 OIDC error redirect 를 발사해 외부로 302 가 나가지 않도록 호출자가 로컬 에러 화면을 렌더해야 한다.
 */
export async function validateRedirectUriInternal(input: {
  clientId: string
  redirectUri: string
}): Promise<boolean> {
  if (!env.oauthInternalSecret) {
    throw new Error("OAUTH_INTERNAL_SECRET not configured on auth-web")
  }
  const res = await fetch(
    `${env.userServiceUrl}/oauth/internal/validate-redirect-uri`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": env.oauthInternalSecret,
      },
      body: JSON.stringify(input),
      cache: "no-store",
      redirect: "manual",
    }
  )
  if (!res.ok) {
    // 401(secret 불일치) / 404(엔드포인트 미배포) 등은 silent false 로 흡수되면 "등록되지 않은
    // redirect_uri" 화면과 구분이 안 돼 디버깅이 어렵다. status + clientId 만이라도 남겨둔다.
    console.warn(
      `[validate-redirect-uri] user-service responded ${res.status} for clientId=${input.clientId}`
    )
    return false
  }
  const body = await readJson<{ valid?: boolean }>(res)
  return body.valid === true
}

export async function checkEmailAvailable(email: string): Promise<boolean> {
  const res = await fetch(
    `${env.userServiceUrl}/users/email-available?email=${encodeURIComponent(email)}`,
    {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
    }
  )
  await throwIfBad(res, "email-available")
  const body = await readApiData<{ available: boolean }>(res)
  return body.available
}

/**
 * 증빙 서류 업로드. 반환값은 S3 public URL 문자열.
 * 법인처럼 자동 검증이 안 되는 경우 이 URL 로 등록하면 관리자 심사(under_review)로 간다.
 */
export async function uploadBusinessFile(
  accessToken: string,
  file: File
): Promise<string> {
  const form = new FormData()
  form.append("folderName", "business")
  form.append("file", file, file.name)

  const res = await fetch(`${env.userServiceUrl}/files/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: form,
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "upload-business-file")
  return readApiData<string>(res)
}

export type CreateBusinessLicenseInput = {
  businessNumber?: string
  representativeName?: string
  /** 개업일자 YYYYMMDD. 국세청 진위확인에 사업자번호·대표자명과 함께 필요하다. */
  startDate?: string
  /** 증빙 첨부 경로. 이 값이 있으면 서버가 번호/대표자명 없이 관리자 심사로 넘긴다. */
  fileUrl?: string
}

export async function createBusinessLicense(
  accessToken: string,
  body: CreateBusinessLicenseInput
): Promise<void> {
  const res = await fetch(`${env.userServiceUrl}/business-licenses`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "create-business-license")
}

/**
 * 등록 직후 심사 상태 확인용. POST 응답에는 상태가 없어서 한 번 더 조회한다.
 * 번호 입력 경로도 국세청 조회가 실패하면 under_review 로 남으므로 클라이언트에서 추정하면 틀린다.
 */
export async function getMyBusinessLicenseStatus(
  accessToken: string
): Promise<string | null> {
  const res = await fetch(`${env.userServiceUrl}/business-licenses/me`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "get-my-business-license")
  const data = await readApiData<{ status?: string } | null>(res)
  return data?.status ?? null
}

export async function checkLoginIdAvailable(loginId: string): Promise<boolean> {
  const res = await fetch(
    `${env.userServiceUrl}/users/login-id-available?loginId=${encodeURIComponent(loginId)}`,
    {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
    }
  )
  await throwIfBad(res, "login-id-available")
  const body = await readApiData<{ available: boolean }>(res)
  return body.available
}

export async function checkNicknameAvailable(
  nickname: string
): Promise<boolean> {
  const res = await fetch(
    `${env.userServiceUrl}/users/nickname-available?nickname=${encodeURIComponent(nickname)}`,
    {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
    }
  )
  await throwIfBad(res, "nickname-available")
  const body = await readApiData<{ available: boolean }>(res)
  return body.available
}

export async function getMe(accessToken: string): Promise<UserProfile> {
  const res = await fetch(`${env.userServiceUrl}/users/me`, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    redirect: "manual",
  })
  await throwIfBad(res, "me")
  return readApiData<UserProfile>(res)
}
