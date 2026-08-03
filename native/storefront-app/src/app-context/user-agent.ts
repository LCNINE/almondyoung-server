export type AppPlatform = "android" | "ios"

/**
 * WebView 의 applicationNameForUserAgent 에 넣을 접미사.
 * storefront middleware 가 이 문자열을 파싱해 앱 컨텍스트를 판정한다.
 */
export function buildUserAgentSuffix(input: {
  appVersion: string
  platform: AppPlatform
}): string {
  return `AlmondyoungApp/${input.appVersion} (${input.platform})`
}
