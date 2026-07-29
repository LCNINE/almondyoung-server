"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import {
  getAccountMeta,
  getRefreshToken,
  invalidateAccountRefreshToken,
  removeAccount,
  upsertAccount,
} from "@/lib/account-store"
import { ApiError } from "@/lib/api-helpers"
import { env } from "@/lib/env"
import {
  clearIdpSessionCookies,
  getIdpAccessToken,
  hasIdpRefreshToken,
  setIdpSessionCookies,
} from "@/lib/idp-session"
import { normalizePhoneNumber } from "@/lib/phone-number"
import { parseAuthorizeRedirectTarget } from "@/lib/oauth-redirect"
import { sanitizeRedirectTo } from "@/lib/redirect"
import {
  callbackSignup,
  checkEmailAvailable,
  checkLoginIdAvailable,
  createBusinessLicense,
  getMyBusinessLicenseStatus,
  findUserId,
  forgotPassword,
  getMe,
  issueOAuthCodeInternal,
  resetPassword,
  restoreAccessToken,
  sendPhoneVerificationCode,
  signIn,
  uploadBusinessFile,
  signUp,
  type LocalSignUpInput,
  type TokenPair,
  verifyPhoneCode,
} from "@/lib/user-service"

export type ActionResult = { ok: true } | { ok: false; error: string }

export type RegisterBusinessActionResult =
  | { ok: true; approved: boolean }
  | { ok: false; error: string }

export type SendRecoveryCodeResult =
  | { ok: true; message: string; phoneNumber: string }
  | { ok: false; error: string }

export type FindUserIdActionResult =
  | { ok: true; loginIds: string[] }
  | { ok: false; error: string }

export type StartPasswordResetResult =
  | { ok: true }
  | { ok: false; error: string }

export type ResetForgottenPasswordResult =
  | { ok: true }
  | { ok: false; error: string }

const PASSWORD_RESET_TOKEN_COOKIE = "passwordResetToken"
const PASSWORD_RESET_TOKEN_MAX_AGE = 60 * 5

// user-service 의 FILE_SIZE_LIMIT / ALLOWED_MIME_TYPES 와 동일하게 유지할 것.
// (서버가 최종 판정하고, 여기서는 왕복 전에 걸러 안내 문구만 개선한다.)
const BUSINESS_FILE_MAX_BYTES = 5 * 1024 * 1024
const BUSINESS_FILE_MIME_TYPES = ["image/jpeg", "image/png", "image/gif"]

/**
 * @param expectUserId 재인증 흐름에서 호출자가 "이 userId 의 자격증명만 허용" 을 강제하고 싶을 때 전달.
 *   resolved 된 me.id 가 다르면 cookie/store 를 건드리지 않고 throw 한다 — 호출부의 try/catch 가 잡아
 *   사용자에게 재인증할 계정이 다르다는 메시지를 돌려준다.
 */
async function promoteTokens(
  tokens: TokenPair,
  rememberMe: boolean,
  expectUserId?: string
): Promise<string> {
  // 권위 있는 userId 는 user-service 의 /users/me 응답만 신뢰한다.
  // 로컬 토큰 payload 디코드는 서명 검증을 거치지 않은 값이라 폴백으로도 쓰지 않는다.
  const me = await getMe(tokens.accessToken)
  if (!me.id) {
    throw new Error("Unable to resolve authenticated user")
  }

  if (expectUserId && me.id !== expectUserId) {
    throw new Error(
      "재인증을 요청한 계정과 다른 계정입니다. 계정 리스트에서 다시 시도하거나, 다른 계정으로 로그인하려면 일반 로그인을 이용해주세요."
    )
  }

  await upsertAccount(
    {
      userId: me.id,
      loginId: me.loginId,
      email: me.email,
      nickname: me.username,
      username: me.username,
    },
    tokens.refreshToken
  )
  await setIdpSessionCookies({ ...tokens, rememberMe })
  return me.id
}

// OAuth code 발급 후 redirect_uri로 302. 성공/실패 모두 throw redirect.
export async function issueOAuthCodeAndRedirect(
  userId: string,
  params: {
    clientId: string
    redirectUri: string
    codeChallenge: string
    scope?: string
    state: string
    nonce?: string
  }
): Promise<never> {
  const { code } = await issueOAuthCodeInternal({
    clientId: params.clientId,
    userId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: "S256",
    scope: params.scope,
    nonce: params.nonce,
  })

  const url = new URL(params.redirectUri)
  url.searchParams.set("code", code)
  url.searchParams.set("state", params.state)
  redirect(url.toString())
}

async function redirectAfterAuth(
  userId: string,
  redirectToRaw: string | null | undefined
): Promise<never> {
  const oauthParams = parseAuthorizeRedirectTarget(redirectToRaw)
  if (oauthParams) {
    return issueOAuthCodeAndRedirect(userId, oauthParams)
  }

  const redirectTo = sanitizeRedirectTo(redirectToRaw)
  redirect(redirectTo ?? "/")
}

/**
 * 화면에 보여줄 에러 문구. ApiError.message 는 `[ctx] 404: ...` 형태의 디버깅용이라
 * 그대로 노출하면 안 된다 — 서버가 내려준 원본 문구(serverMessage)만 쓴다.
 */
function userMessage(e: unknown, fallback: string) {
  if (e instanceof ApiError) return e.serverMessage
  return e instanceof Error ? e.message : fallback
}

function getNormalizedPhoneNumber(formData: FormData) {
  const phoneNumber = normalizePhoneNumber(
    String(formData.get("phoneNumber") ?? "")
  )

  if (!phoneNumber) {
    throw new Error("휴대폰 번호를 확인해주세요. 예: 01012345678")
  }

  return phoneNumber
}

function getVerificationCode(formData: FormData) {
  const code = String(formData.get("code") ?? "").trim()

  if (!/^\d{6}$/.test(code)) {
    throw new Error("인증번호 6자리를 입력해주세요.")
  }

  return code
}

async function setPasswordResetTokenCookie(token: string) {
  const jar = await cookies()
  jar.set(PASSWORD_RESET_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/forgot-password",
    maxAge: PASSWORD_RESET_TOKEN_MAX_AGE,
  })
}

async function getPasswordResetTokenCookie() {
  const jar = await cookies()
  return jar.get(PASSWORD_RESET_TOKEN_COOKIE)?.value ?? null
}

async function clearPasswordResetTokenCookie() {
  const jar = await cookies()
  jar.set(PASSWORD_RESET_TOKEN_COOKIE, "", {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSameSite,
    path: "/forgot-password",
    maxAge: 0,
  })
}

export async function sendRecoveryCodeAction(
  formData: FormData
): Promise<SendRecoveryCodeResult> {
  let phoneNumber: string

  try {
    phoneNumber = getNormalizedPhoneNumber(formData)
    const result = await sendPhoneVerificationCode({
      countryCode: "KR",
      phoneNumber,
    })

    return { ok: true, message: result.message, phoneNumber }
  } catch (e) {
    return {
      ok: false,
      error: userMessage(
        e,
        "인증번호를 보내지 못했어요. 잠시 후 다시 시도해 주세요."
      ),
    }
  }
}

export async function findUserIdAction(
  formData: FormData
): Promise<FindUserIdActionResult> {
  try {
    const phoneNumber = getNormalizedPhoneNumber(formData)
    const code = getVerificationCode(formData)

    await verifyPhoneCode({ phoneNumber, code })
    const result = await findUserId({ phoneNumber })

    return { ok: true, loginIds: result.loginIds }
  } catch (e) {
    return {
      ok: false,
      error: userMessage(
        e,
        "아이디를 찾지 못했어요. 입력한 정보를 확인해 주세요."
      ),
    }
  }
}

export async function startPasswordResetAction(
  formData: FormData
): Promise<StartPasswordResetResult> {
  try {
    const loginId = String(formData.get("loginId") ?? "").trim()
    const phoneNumber = getNormalizedPhoneNumber(formData)
    const code = getVerificationCode(formData)

    if (!loginId) {
      throw new Error("아이디를 입력해주세요.")
    }

    await verifyPhoneCode({ phoneNumber, code })
    const result = await forgotPassword({ loginId, phoneNumber })
    await setPasswordResetTokenCookie(result.verificationToken)

    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: userMessage(
        e,
        "본인 확인에 실패했어요. 입력한 정보를 확인해 주세요."
      ),
    }
  }
}

export async function resetForgottenPasswordAction(
  formData: FormData
): Promise<ResetForgottenPasswordResult> {
  try {
    const password = String(formData.get("password") ?? "")
    const passwordConfirm = String(formData.get("passwordConfirm") ?? "")

    if (password !== passwordConfirm) {
      throw new Error("비밀번호가 일치하지 않습니다.")
    }

    if (password.length < 8 || password.length > 20) {
      throw new Error("비밀번호는 8~20자여야 합니다.")
    }

    if (
      !/^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).+$/.test(
        password
      )
    ) {
      throw new Error(
        "비밀번호는 영문, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다."
      )
    }

    const token = await getPasswordResetTokenCookie()
    if (!token) {
      throw new Error(
        "비밀번호 재설정 인증이 만료되었습니다. 다시 인증해주세요."
      )
    }

    await resetPassword({ token, password })
    await clearPasswordResetTokenCookie()

    return { ok: true }
  } catch (e) {
    return {
      ok: false,
      error: userMessage(
        e,
        "비밀번호를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요."
      ),
    }
  }
}

export async function signInAction(formData: FormData): Promise<ActionResult> {
  const loginId = String(formData.get("loginId") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  const rememberMe = formData.get("rememberMe") === "on"
  const redirectToRaw = String(formData.get("redirectTo") ?? "")
  // 재인증 모드 (계정 허브에서 stale RT 로 진입) 에서는 hidden 필드로 전달된 reauthUserId 와
  // 실제 로그인된 userId 를 엄격 매칭한다. 빈 문자열 ("") 이면 일반 signin 으로 취급.
  const reauthUserId = String(formData.get("reauthUserId") ?? "").trim()
  let userId: string

  try {
    const tokens = await signIn({ loginId, password, rememberMe })
    userId = await promoteTokens(tokens, rememberMe, reauthUserId || undefined)
  } catch (e) {
    if (e instanceof ApiError) {
      // 404(존재하지 않는 사용자)도 자격 증명 오류로 묶는다 — 계정 존재 여부를 흘리지 않고,
      // "일시적 오류" 로 오인해 같은 아이디로 계속 재시도하는 것도 막는다.
      const msg =
        e.status === 400 || e.status === 401 || e.status === 404
          ? "아이디 또는 비밀번호가 올바르지 않아요."
          : "로그인하지 못했어요. 잠시 후 다시 시도해 주세요."
      return { ok: false, error: msg }
    }
    return { ok: false, error: userMessage(e, "로그인하지 못했어요.") }
  }

  return redirectAfterAuth(userId, redirectToRaw)
}

/** 이메일/아이디 사전 중복확인이 공유하는 결과 형태. */
export type CheckEmailResult =
  | { status: "available" }
  | { status: "taken" }
  | { status: "invalid"; message: string }
  | { status: "error"; message: string }

export async function checkLoginIdAvailableAction(
  loginId: string
): Promise<CheckEmailResult> {
  const normalized = loginId.trim()
  if (!normalized) {
    return { status: "invalid", message: "아이디를 입력해주세요." }
  }

  try {
    const available = await checkLoginIdAvailable(normalized)
    return available ? { status: "available" } : { status: "taken" }
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      return {
        status: "invalid",
        message: "아이디는 영문 소문자와 숫자만, 4~20자로 입력해주세요.",
      }
    }
    return {
      status: "error",
      message: "아이디 확인 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.",
    }
  }
}

export async function checkEmailAvailableAction(
  email: string
): Promise<CheckEmailResult> {
  const normalized = email.trim()
  if (!normalized) {
    return { status: "invalid", message: "이메일을 입력해주세요." }
  }

  try {
    const available = await checkEmailAvailable(normalized)
    return available ? { status: "available" } : { status: "taken" }
  } catch (e) {
    // user-service 가 400 (형식 오류) 을 던지면 사용자에게 형식 안내로 노출한다.
    if (e instanceof ApiError && e.status === 400) {
      return { status: "invalid", message: "올바른 이메일 형식이 아닙니다." }
    }
    return {
      status: "error",
      message: "이메일 확인 중 오류가 발생했어요. 잠시 후 다시 시도해주세요.",
    }
  }
}

export async function signUpAction(formData: FormData): Promise<ActionResult> {
  const password = String(formData.get("password") ?? "")
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "")
  const normalizedPhoneNumber = normalizePhoneNumber(
    String(formData.get("phoneNumber") ?? "")
  )

  if (password !== passwordConfirm) {
    return { ok: false, error: "비밀번호가 일치하지 않습니다." }
  }

  if (!normalizedPhoneNumber) {
    return {
      ok: false,
      error: "휴대폰 번호를 확인해주세요. 예: 01012345678",
    }
  }

  const input: LocalSignUpInput = {
    loginId: String(formData.get("loginId") ?? "").trim(),
    password,
    email: String(formData.get("email") ?? "").trim(),
    username: String(formData.get("username") ?? "").trim(),
    nickname: String(formData.get("nickname") ?? "").trim(),
    birthday: String(formData.get("birthday") ?? "").trim(),
    phoneNumber: normalizedPhoneNumber,
    isOver14: formData.get("isOver14") === "on",
    termsOfService: formData.get("termsOfService") === "on",
    electronicTransaction: formData.get("electronicTransaction") === "on",
    privacyPolicy: formData.get("privacyPolicy") === "on",
    thirdPartySharing: formData.get("thirdPartySharing") === "on",
    marketingConsent: formData.get("marketingConsent") === "on",
  }
  const redirectToRaw = String(formData.get("redirectTo") ?? "")
  let userId: string

  // 가입 단계에서 이메일 인증을 강제하지 않는다. signUp 응답의 단발성 signupToken 을 즉시
  // callbackSignup 으로 교환해 세션을 시작한다. 이전처럼 body 의 userId 를 직접 신뢰하지 않으므로
  // 외부 호출자가 임의 userId 로 callbackSignup 을 호출하는 우회는 차단된다.
  try {
    // 휴대폰 인증은 여기서만 검증한다. 클라이언트가 "인증됐다"고 보내는 플래그를 믿으면
    // 폼을 직접 조작해 남의 번호로 가입할 수 있다. Twilio Verify 는 approve 된 코드를
    // 재검증할 수 없으므로 스텝 UI 에서는 부르지 않고 이 지점 한 번만 부른다.
    await verifyPhoneCode({
      phoneNumber: normalizedPhoneNumber,
      code: getVerificationCode(formData),
    })
    const result = await signUp(input)
    const tokens = await callbackSignup(result.signupToken)
    userId = await promoteTokens(tokens, false)
  } catch (e) {
    return {
      ok: false,
      error: userMessage(e, "가입하지 못했어요. 잠시 후 다시 시도해 주세요."),
    }
  }

  // 여기서 바로 리다이렉트하지 않는다 — 계정은 이미 만들어졌고 세션도 붙었으므로,
  // 이어지는 사업자 인증 스텝을 보여준 뒤 finishSignupAction 이 마무리한다.
  // (사업자 인증은 건너뛸 수 있으므로 가입 성공 자체를 막지 않는다.)
  void userId
  void redirectToRaw
  return { ok: true }
}

/**
 * 가입 스텝을 모두 마친 뒤(사업자 인증 완료 또는 건너뛰기) 원래 가려던 곳으로 보낸다.
 *
 * userId 를 인자로 받지 않는다 — 받으면 임의 userId 로 OAuth code 를 발급받아 남의 계정으로
 * 로그인할 수 있다. 방금 심은 세션 쿠키에서 access token 을 꺼내 /users/me 로 확인한다.
 */
export async function finishSignupAction(
  redirectToRaw: string
): Promise<ActionResult> {
  // accessToken 쿠키는 15분짜리라(ACCESS_MAX_AGE) 사업자 인증 스텝에 조금만 머물러도 사라진다.
  // 2주짜리 refreshToken 으로 복원해서, 가입은 끝났는데 마지막 이동만 막히는 상황을 없앤다.
  const accessToken =
    (await getIdpAccessToken()) ?? (await restoreSessionFromRefreshToken())
  if (!accessToken) {
    return {
      ok: false,
      error: "가입은 완료됐어요. 세션이 만료되어 다시 로그인이 필요합니다.",
    }
  }

  const me = await getMe(accessToken)
  if (!me.id) {
    return {
      ok: false,
      error: "세션을 확인하지 못했습니다. 다시 로그인해주세요.",
    }
  }

  return redirectAfterAuth(me.id, redirectToRaw)
}

/** refreshToken 으로 access 를 재발급하고 세션 쿠키를 갱신한다. 실패하면 null. */
async function restoreSessionFromRefreshToken(): Promise<string | null> {
  const refreshToken = await hasIdpRefreshToken()
  if (!refreshToken) return null

  const restored = await restoreAccessToken(refreshToken)
  if (!restored.ok) return null

  // restore-token 은 access 만 새로 준다. refresh 는 기존 쿠키 값을 그대로 유지한다.
  await setIdpSessionCookies({
    accessToken: restored.accessToken,
    refreshToken,
  })
  return restored.accessToken
}

/**
 * 가입 직후 사업자 인증. 국세청 진위확인은 user-service 가 직접 수행하므로
 * 여기서는 입력값만 전달한다. 법인 번호는 user-service 가 400 으로 거절한다.
 */
export async function registerBusinessAction(
  formData: FormData
): Promise<RegisterBusinessActionResult> {
  const accessToken =
    (await getIdpAccessToken()) ?? (await restoreSessionFromRefreshToken())
  if (!accessToken) {
    return {
      ok: false,
      error: "가입은 완료됐어요. 세션이 만료되어 다시 로그인이 필요합니다.",
    }
  }

  // 증빙 첨부 경로가 우선. 법인처럼 자동 검증이 안 되는 경우 여기로 들어와 관리자 심사로 간다.
  const file = formData.get("file")
  const hasFile = file instanceof File && file.size > 0

  // user-service FileValidatorPipe 와 같은 규칙. 여기서 먼저 걸러 업로드 왕복을 아끼고
  // 사용자에게도 서버 원문 대신 읽기 쉬운 문구를 준다.
  if (hasFile) {
    if (file.size > BUSINESS_FILE_MAX_BYTES) {
      return { ok: false, error: "파일 크기는 5MB 이하만 첨부할 수 있습니다." }
    }
    if (!BUSINESS_FILE_MIME_TYPES.includes(file.type)) {
      return {
        ok: false,
        error: "JPG, PNG, GIF 이미지 파일만 첨부할 수 있습니다.",
      }
    }
  }

  const businessNumber = String(formData.get("businessNumber") ?? "").replace(
    /\D/g,
    ""
  )
  const representativeName = String(
    formData.get("representativeName") ?? ""
  ).trim()
  const startDate = String(formData.get("startDate") ?? "").replace(/\D/g, "")

  if (!hasFile) {
    if (businessNumber.length !== 10) {
      return { ok: false, error: "사업자등록번호 10자리를 입력해주세요." }
    }
    if (!representativeName) {
      return { ok: false, error: "대표자명을 입력해주세요." }
    }
    if (!/^\d{8}$/.test(startDate)) {
      return { ok: false, error: "개업일자를 YYYYMMDD 8자리로 입력해주세요." }
    }
  }

  try {
    if (hasFile) {
      const fileUrl = await uploadBusinessFile(accessToken, file)
      await createBusinessLicense(accessToken, { fileUrl })
    } else {
      await createBusinessLicense(accessToken, {
        businessNumber,
        representativeName,
        startDate,
      })
    }
    // 상태 조회가 실패해도 등록 자체는 성공이다. 이 경우 "확인 중"으로 안내한다.
    const status = await getMyBusinessLicenseStatus(accessToken).catch(
      () => null
    )
    return { ok: true, approved: status === "approved" }
  } catch (e) {
    return {
      ok: false,
      error: userMessage(
        e,
        "사업자 인증에 실패했어요. 입력한 정보를 확인해 주세요."
      ),
    }
  }
}

export async function selectAccountAction(
  userId: string,
  redirectToRaw: string
): Promise<ActionResult> {
  const refreshToken = await getRefreshToken(userId)

  // RT 쿠키 자체가 사라진 경우 (브라우저 만료/수동 삭제 등) 도 reauth 흐름과 동일하게 취급.
  // 계정 허브의 "재로그인" 버튼이 이 경로로 들어오므로 에러로 끊지 말고 비밀번호 재입력 페이지로.
  if (!refreshToken) {
    const meta = await getAccountMeta(userId)
    const qs = new URLSearchParams()
    if (meta?.loginId) qs.set("login_id", meta.loginId)
    qs.set("reauth_user_id", userId)
    if (redirectToRaw) qs.set("redirect_to", redirectToRaw)
    redirect(`/signin?${qs.toString()}`)
  }

  // 클라이언트가 넘긴 userId 를 그대로 신뢰하지 않는다. refreshToken 으로 access 를 복원한 뒤
  // user-service /users/me 응답의 id 를 권위 있는 userId 로 사용 (서명 검증을 user-service 에 위임).
  const restored = await restoreAccessToken(refreshToken)

  // user-service 가 401 로 응답 = stale refresh token. (다른 클라이언트의 재로그인으로 row overwrite,
  // 어딘가에서의 logout, 자연 만료 등을 모두 포함.) 비밀번호 재인증 페이지로 보낸다 — loginId 는 메타
  // 쿠키에서 prefill, reauth_user_id 로 엄격 매칭을 강제. 메타에 loginId 가 누락된 옛 쿠키면 prefill
  // 없이 재인증 모드만 표시한다.
  if (!restored.ok && restored.reauthRequired) {
    const meta = await getAccountMeta(userId)
    const qs = new URLSearchParams()
    if (meta?.loginId) qs.set("login_id", meta.loginId)
    qs.set("reauth_user_id", userId)
    if (redirectToRaw) qs.set("redirect_to", redirectToRaw)
    redirect(`/signin?${qs.toString()}`)
  }

  if (!restored.ok) {
    return { ok: false, error: restored.message }
  }

  const accessToken = restored.accessToken

  let resolvedUserId: string
  try {
    const me = await getMe(accessToken)
    resolvedUserId = me.id
  } catch (e) {
    return {
      ok: false,
      error: userMessage(e, "세션을 확인하지 못했어요."),
    }
  }

  if (resolvedUserId !== userId) {
    return { ok: false, error: "계정 정보가 일치하지 않습니다" }
  }

  await setIdpSessionCookies({ accessToken, refreshToken })
  return redirectAfterAuth(resolvedUserId, redirectToRaw)
}

export async function removeAccountAction(userId: string): Promise<void> {
  await removeAccount(userId)
}

/**
 * RP-Initiated Logout (auth-web 측 진입점).
 * user-service /oauth/end_session 호출 → 사용자 전체 OAuth/내부 토큰 일괄 revoke.
 * parent cookie도 만료. 마지막에 redirectTo (또는 / )로 navigate.
 */
export async function signOutAction(
  redirectTo?: string | null
): Promise<never> {
  const accessToken = await getIdpAccessToken()

  // 활성 계정 userId 를 미리 확보 (계정 허브 RT 무효화용). 식별 실패해도 로그아웃은 진행.
  let userId: string | null = null
  if (accessToken) {
    try {
      userId = (await getMe(accessToken)).id
    } catch {
      userId = null
    }
  }

  // user-service에 server-to-server 호출. 토큰이 없으면 cookie clear만.
  if (accessToken) {
    try {
      await fetch(`${env.userServiceUrl}/oauth/end_session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      })
    } catch {
      // user-service 도달 실패해도 클라이언트 cookie는 비움 (idempotent).
    }
  }

  // active session 쿠키 만료 + 계정 허브 per-account RT 무효화 (다음 선택 시 비밀번호 재입력 강제).
  await clearIdpSessionCookies()
  if (userId) await invalidateAccountRefreshToken(userId)
  redirect(sanitizeRedirectTo(redirectTo) ?? "/")
}

export async function completeSignupCallback(
  signupToken: string,
  redirectToRaw: string
): Promise<ActionResult> {
  let resolvedUserId: string

  try {
    const tokens = await callbackSignup(signupToken)
    resolvedUserId = await promoteTokens(tokens, false)
  } catch (e) {
    return {
      ok: false,
      error: userMessage(e, "가입 마무리에 실패했어요."),
    }
  }

  return redirectAfterAuth(resolvedUserId, redirectToRaw)
}
