import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { siteConfig } from "@/lib/config/site"
import {
  extractCountryCodeFromPath,
  normalizeRedirectPath,
  toLocalizedPath,
} from "@/lib/utils/locale-path"
import { removeAccessToken, removeRefreshToken } from "@lib/data/cookies"

/**
 * 401 Unauthorized 에러인지 확인
 */
export function isUnauthorizedError(error: unknown): boolean {
  const err = error as any
  return (
    err?.response?.status === 401 ||
    err?.status === 401 ||
    err?.statusText === "Unauthorized" ||
    err?.response?.statusText === "Unauthorized"
  )
}

/**
 * 로그인 페이지로 리다이렉트 (현재 경로를 redirect_to에 저장)
 */
export async function redirectToLogin(): Promise<never> {
  const headersList = await headers()
  const pathname = headersList.get("x-pathname") || "/"
  const countryCode = extractCountryCodeFromPath(pathname, "kr")
  const loginPath = toLocalizedPath(countryCode, siteConfig.auth.loginUrl)
  const redirectPath = normalizeRedirectPath(pathname)

  redirect(`${loginPath}?redirect_to=${encodeURIComponent(redirectPath)}`)
}

/**
 * Medusa 401 에러 처리: 유저서비스 토큰 삭제 후 로그인 페이지로 리다이렉트
 */
export async function handleMedusaAuthError(
  error: unknown
): Promise<never | null> {
  if (isUnauthorizedError(error)) {
    await removeAccessToken()
    await removeRefreshToken()
    return redirectToLogin()
  }
  return null
}
