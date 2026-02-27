const COUNTRY_PREFIX_REGEX = /^\/([a-z]{2})(?=\/|$)/i
const COUNTRY_SEGMENT_REGEX = /^[a-z]{2}$/i

const hasExternalScheme = (value: string) =>
  value.startsWith("http://") ||
  value.startsWith("https://") ||
  value.startsWith("//")

/**
 * redirect_to 값을 내부 경로로 정규화합니다.
 * - 절대 URL은 허용하지 않음
 * - 선행 countryCode(/kr 등)는 제거
 */
export function normalizeRedirectPath(path?: string | null): string {
  if (!path) return "/"

  const trimmed = path.trim()
  if (!trimmed || hasExternalScheme(trimmed)) {
    return "/"
  }

  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  const withoutCountry = withSlash.replace(COUNTRY_PREFIX_REGEX, "")

  return withoutCountry || "/"
}

/**
 * pathname에서 countryCode를 추출합니다.
 */
export function extractCountryCodeFromPath(
  pathname?: string | null,
  fallback = "kr"
): string {
  const segment = pathname?.split("/")[1]

  if (segment && COUNTRY_SEGMENT_REGEX.test(segment)) {
    return segment.toLowerCase()
  }

  return fallback.toLowerCase()
}

/**
 * countryCode + 내부 경로를 결합한 로컬라이즈 경로를 생성합니다.
 */
export function toLocalizedPath(
  countryCode: string,
  path?: string | null
): string {
  const normalizedCountry = extractCountryCodeFromPath(
    `/${countryCode}`,
    "kr"
  )
  const normalizedPath = normalizeRedirectPath(path)

  if (normalizedPath === "/") {
    return `/${normalizedCountry}`
  }

  return `/${normalizedCountry}${normalizedPath}`
}
