import { normalizeRedirectPath } from "./locale-path"

/**
 * 현재 pathname에서 countryCode 접두사를 제거한 경로를 반환합니다.
 */
export function getPathWithoutCountry(countryCode: string) {
  const normalizedCountry = countryCode.toLowerCase()
  const countryPrefixRegex = new RegExp(`^/${normalizedCountry}(?=/|$)`, "i")
  const pathWithoutCountry = window.location.pathname.replace(
    countryPrefixRegex,
    ""
  )

  return normalizeRedirectPath(pathWithoutCountry)
}
