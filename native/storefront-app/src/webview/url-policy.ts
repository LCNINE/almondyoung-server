export type UrlClass = "internal" | "external"

/**
 * 메인 웹뷰에 머무를 URL 인지 판정한다.
 * 외부 도메인(PG 결제창, 정책 링크 등)을 메인 웹뷰에 가두면 히스토리가 꼬여
 * 사용자가 앱에 갇히므로 반드시 분리한다.
 */
export function classifyUrl(url: string, internalHosts: string[]): UrlClass {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return "external"
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "external"
  return internalHosts.includes(parsed.hostname) ? "internal" : "external"
}
