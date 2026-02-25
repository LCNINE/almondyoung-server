/**
 * 현재 pathname에서 countryCode 접두사를 제거한 경로를 반환합니다.
 */
export function getPathWithoutCountry(countryCode: string) {
  return window.location.pathname.replace(`/${countryCode}`, "")
}
