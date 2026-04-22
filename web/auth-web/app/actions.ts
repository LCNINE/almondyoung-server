"use server";

import { redirect } from "next/navigation";

import {
  getRefreshToken,
  removeAccount,
  upsertAccount,
} from "@/lib/account-store";
import { decodeJwtPayload, isExpired } from "@/lib/jwt";
import { setParentAuthCookies } from "@/lib/parent-cookies";
import { sanitizeRedirectTo } from "@/lib/redirect";
import {
  callbackSignup,
  getMe,
  restoreAccessToken,
  signIn,
  signUp,
  type LocalSignUpInput,
  type TokenPair,
} from "@/lib/user-service";

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

async function promoteTokens(
  tokens: TokenPair,
  rememberMe: boolean,
): Promise<void> {
  const me = await getMe(tokens.accessToken);
  const refreshPayload = decodeJwtPayload<{ sub?: string }>(tokens.refreshToken);
  const accessPayload = decodeJwtPayload<{ sub?: string }>(tokens.accessToken);
  const userId = me.id || accessPayload?.sub || refreshPayload?.sub;

  if (!userId) {
    throw new Error("Unable to resolve authenticated user");
  }

  await upsertAccount(
    {
      userId,
      email: me.email,
      nickname: me.username,
      username: me.username,
    },
    tokens.refreshToken,
  );
  await setParentAuthCookies({ ...tokens, rememberMe });
}

export async function signInAction(formData: FormData): Promise<ActionResult> {
  const loginId = String(formData.get("loginId") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const rememberMe = formData.get("rememberMe") === "on";
  const redirectToRaw = String(formData.get("redirectTo") ?? "");
  const redirectTo = sanitizeRedirectTo(redirectToRaw);

  try {
    const tokens = await signIn({ loginId, password, rememberMe });
    await promoteTokens(tokens, rememberMe);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "로그인 실패" };
  }
  redirect(redirectTo ?? "/");
}

export async function signUpAction(
  formData: FormData,
): Promise<ActionResult> {
  const password = String(formData.get("password") ?? "");
  const passwordConfirm = String(formData.get("passwordConfirm") ?? "");

  if (password !== passwordConfirm) {
    return { ok: false, error: "비밀번호가 일치하지 않습니다." };
  }

  const input: LocalSignUpInput = {
    loginId: String(formData.get("loginId") ?? "").trim(),
    password,
    email: String(formData.get("email") ?? "").trim(),
    username: String(formData.get("username") ?? "").trim(),
    nickname: String(formData.get("nickname") ?? "").trim(),
    birthday: String(formData.get("birthday") ?? "").trim(),
    phoneNumber: String(formData.get("phoneNumber") ?? "").trim(),
    isOver14: formData.get("isOver14") === "on",
    termsOfService: formData.get("termsOfService") === "on",
    electronicTransaction: formData.get("electronicTransaction") === "on",
    privacyPolicy: formData.get("privacyPolicy") === "on",
    thirdPartySharing: formData.get("thirdPartySharing") === "on",
    marketingConsent: formData.get("marketingConsent") === "on",
  };
  const redirectToRaw = String(formData.get("redirectTo") ?? "");
  const redirectTo = sanitizeRedirectTo(redirectToRaw);

  try {
    const result = await signUp(input);
    const tokens = await callbackSignup(result.userId);
    await promoteTokens(tokens, false);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "회원가입 실패" };
  }
  redirect(redirectTo ?? "/");
}

export async function selectAccountAction(
  userId: string,
  redirectToRaw: string,
): Promise<ActionResult> {
  const redirectTo = sanitizeRedirectTo(redirectToRaw);
  const refreshToken = await getRefreshToken(userId);
  if (!refreshToken) return { ok: false, error: "저장된 계정을 찾을 수 없습니다" };
  const payload = decodeJwtPayload<{ sub: string; exp?: number }>(refreshToken);
  if (!payload || isExpired(payload.exp)) {
    return { ok: false, error: "세션이 만료됐습니다. 다시 로그인해주세요" };
  }

  try {
    const accessToken = await restoreAccessToken(refreshToken);
    await setParentAuthCookies({ accessToken, refreshToken });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "토큰 갱신 실패",
    };
  }
  redirect(redirectTo ?? "/");
}

export async function removeAccountAction(userId: string): Promise<void> {
  await removeAccount(userId);
}

export async function completeSignupCallback(
  userId: string,
  redirectToRaw: string,
): Promise<ActionResult> {
  const redirectTo = sanitizeRedirectTo(redirectToRaw);
  try {
    const tokens = await callbackSignup(userId);
    await promoteTokens(tokens, false);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "가입 완료 처리 실패",
    };
  }
  redirect(redirectTo ?? "/");
}
