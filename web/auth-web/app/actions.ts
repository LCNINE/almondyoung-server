"use server";

import { redirect } from "next/navigation";

import {
  getAccountMeta,
  getRefreshToken,
  removeAccount,
  upsertAccount,
} from "@/lib/account-store";
import { env } from "@/lib/env";
import {
  clearIdpSessionCookies,
  getIdpAccessToken,
  setIdpSessionCookies,
} from "@/lib/idp-session";
import { normalizePhoneNumber } from "@/lib/phone-number";
import { parseAuthorizeRedirectTarget } from "@/lib/oauth-redirect";
import { sanitizeRedirectTo } from "@/lib/redirect";
import {
  callbackSignup,
  getMe,
  issueOAuthCodeInternal,
  restoreAccessToken,
  signIn,
  signUp,
  type LocalSignUpInput,
  type TokenPair,
} from "@/lib/user-service";

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * @param expectUserId 재인증 흐름에서 호출자가 "이 userId 의 자격증명만 허용" 을 강제하고 싶을 때 전달.
 *   resolved 된 me.id 가 다르면 cookie/store 를 건드리지 않고 throw 한다 — 호출부의 try/catch 가 잡아
 *   사용자에게 재인증할 계정이 다르다는 메시지를 돌려준다.
 */
async function promoteTokens(
  tokens: TokenPair,
  rememberMe: boolean,
  expectUserId?: string,
): Promise<string> {
  // 권위 있는 userId 는 user-service 의 /users/me 응답만 신뢰한다.
  // 로컬 토큰 payload 디코드는 서명 검증을 거치지 않은 값이라 폴백으로도 쓰지 않는다.
  const me = await getMe(tokens.accessToken);
  if (!me.id) {
    throw new Error("Unable to resolve authenticated user");
  }

  if (expectUserId && me.id !== expectUserId) {
    throw new Error(
      "재인증을 요청한 계정과 다른 계정입니다. 계정 리스트에서 다시 시도하거나, 다른 계정으로 로그인하려면 일반 로그인을 이용해주세요.",
    );
  }

  await upsertAccount(
    {
      userId: me.id,
      loginId: me.loginId,
      email: me.email,
      nickname: me.username,
      username: me.username,
    },
    tokens.refreshToken,
  );
  await setIdpSessionCookies({ ...tokens, rememberMe });
  return me.id;
}

// OAuth code 발급 후 redirect_uri로 302. 성공/실패 모두 throw redirect.
export async function issueOAuthCodeAndRedirect(
  userId: string,
  params: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    scope?: string;
    state: string;
    nonce?: string;
  },
): Promise<never> {
  const { code } = await issueOAuthCodeInternal({
    clientId: params.clientId,
    userId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: "S256",
    scope: params.scope,
    nonce: params.nonce,
  });

  const url = new URL(params.redirectUri);
  url.searchParams.set("code", code);
  url.searchParams.set("state", params.state);
  redirect(url.toString());
}

async function redirectAfterAuth(
  userId: string,
  redirectToRaw: string | null | undefined,
): Promise<never> {
  const oauthParams = parseAuthorizeRedirectTarget(redirectToRaw);
  if (oauthParams) {
    return issueOAuthCodeAndRedirect(userId, oauthParams);
  }

  const redirectTo = sanitizeRedirectTo(redirectToRaw);
  redirect(redirectTo ?? "/");
}

export async function signInAction(formData: FormData): Promise<ActionResult> {
  const loginId = String(formData.get("loginId") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const rememberMe = formData.get("rememberMe") === "on";
  const redirectToRaw = String(formData.get("redirectTo") ?? "");
  // 재인증 모드 (계정 허브에서 stale RT 로 진입) 에서는 hidden 필드로 전달된 reauthUserId 와
  // 실제 로그인된 userId 를 엄격 매칭한다. 빈 문자열 ("") 이면 일반 signin 으로 취급.
  const reauthUserId = String(formData.get("reauthUserId") ?? "").trim();
  let userId: string;

  try {
    const tokens = await signIn({ loginId, password, rememberMe });
    userId = await promoteTokens(tokens, rememberMe, reauthUserId || undefined);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "로그인 실패" };
  }

  return redirectAfterAuth(userId, redirectToRaw);
}

export async function signUpAction(formData: FormData): Promise<ActionResult> {
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");
  const normalizedPhoneNumber = normalizePhoneNumber(
    String(formData.get("phoneNumber") ?? ""),
  );

  if (password !== passwordConfirm) {
    return { ok: false, error: "비밀번호가 일치하지 않습니다." };
  }

  if (!normalizedPhoneNumber) {
    return {
      ok: false,
      error: "휴대폰 번호를 확인해주세요. 예: 01012345678",
    };
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
  };
  const redirectToRaw = String(formData.get("redirectTo") ?? "");
  let userId: string;

  // 가입 단계에서 이메일 인증을 강제하지 않는다. signUp 응답의 단발성 signupToken 을 즉시
  // callbackSignup 으로 교환해 세션을 시작한다. 이전처럼 body 의 userId 를 직접 신뢰하지 않으므로
  // 외부 호출자가 임의 userId 로 callbackSignup 을 호출하는 우회는 차단된다.
  try {
    const result = await signUp(input);
    const tokens = await callbackSignup(result.signupToken);
    userId = await promoteTokens(tokens, false);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "회원가입 실패",
    };
  }

  return redirectAfterAuth(userId, redirectToRaw);
}

export async function selectAccountAction(
  userId: string,
  redirectToRaw: string,
): Promise<ActionResult> {
  const refreshToken = await getRefreshToken(userId);
  if (!refreshToken) return { ok: false, error: "저장된 계정을 찾을 수 없습니다" };

  // 클라이언트가 넘긴 userId 를 그대로 신뢰하지 않는다. refreshToken 으로 access 를 복원한 뒤
  // user-service /users/me 응답의 id 를 권위 있는 userId 로 사용 (서명 검증을 user-service 에 위임).
  const restored = await restoreAccessToken(refreshToken);

  // user-service 가 401 로 응답 = stale refresh token. (다른 클라이언트의 재로그인으로 row overwrite,
  // 어딘가에서의 logout, 자연 만료 등을 모두 포함.) 비밀번호 재인증 페이지로 보낸다 — loginId 는 메타
  // 쿠키에서 prefill, reauth_user_id 로 엄격 매칭을 강제. 메타에 loginId 가 누락된 옛 쿠키면 prefill
  // 없이 재인증 모드만 표시한다.
  if (!restored.ok && restored.reauthRequired) {
    const meta = await getAccountMeta(userId);
    const qs = new URLSearchParams();
    if (meta?.loginId) qs.set("login_id", meta.loginId);
    qs.set("reauth_user_id", userId);
    if (redirectToRaw) qs.set("redirect_to", redirectToRaw);
    redirect(`/signin?${qs.toString()}`);
  }

  if (!restored.ok) {
    return { ok: false, error: restored.message };
  }

  const accessToken = restored.accessToken;

  let resolvedUserId: string;
  try {
    const me = await getMe(accessToken);
    resolvedUserId = me.id;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "세션 검증 실패",
    };
  }

  if (resolvedUserId !== userId) {
    return { ok: false, error: "계정 정보가 일치하지 않습니다" };
  }

  await setIdpSessionCookies({ accessToken, refreshToken });
  return redirectAfterAuth(resolvedUserId, redirectToRaw);
}

export async function removeAccountAction(userId: string): Promise<void> {
  await removeAccount(userId);
}

/**
 * RP-Initiated Logout (auth-web 측 진입점).
 * user-service /oauth/end_session 호출 → 사용자 전체 OAuth/내부 토큰 일괄 revoke.
 * parent cookie도 만료. 마지막에 redirectTo (또는 / )로 navigate.
 */
export async function signOutAction(redirectTo?: string | null): Promise<never> {
  const accessToken = await getIdpAccessToken();

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
      });
    } catch {
      // user-service 도달 실패해도 클라이언트 cookie는 비움 (idempotent).
    }
  }

  await clearIdpSessionCookies();
  redirect(sanitizeRedirectTo(redirectTo) ?? "/");
}

export async function completeSignupCallback(
  signupToken: string,
  redirectToRaw: string,
): Promise<ActionResult> {
  let resolvedUserId: string;

  try {
    const tokens = await callbackSignup(signupToken);
    resolvedUserId = await promoteTokens(tokens, false);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "가입 완료 처리 실패",
    };
  }

  return redirectAfterAuth(resolvedUserId, redirectToRaw);
}
