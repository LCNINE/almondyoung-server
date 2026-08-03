export type AppContext = { platform: "android" | "ios"; version: string }

export const APP_CONTEXT_HEADER = "x-almondyoung-app"

const UA_PATTERN = /AlmondyoungApp\/(\d+\.\d+\.\d+)\s+\((android|ios)\)/

/** 앱 WebView 가 붙인 UA 접미사를 파싱한다. 앱이 아니면 null. */
export function parseAppContext(
  userAgent: string | null | undefined
): AppContext | null {
  if (!userAgent) return null
  const m = UA_PATTERN.exec(userAgent)
  if (!m) return null
  return { version: m[1], platform: m[2] as AppContext["platform"] }
}

/** 미들웨어가 헤더에 실을 직렬화 형태. */
export function serializeAppContext(ctx: AppContext): string {
  return `${ctx.platform}/${ctx.version}`
}

/** 서버 컴포넌트가 헤더에서 복원하는 형태. */
export function deserializeAppContext(raw: string | null | undefined): AppContext | null {
  if (!raw) return null
  const [platform, version] = raw.split("/")
  if (platform !== "android" && platform !== "ios") return null
  if (!version) return null
  return { platform, version }
}
