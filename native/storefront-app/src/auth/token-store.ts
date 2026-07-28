export type StoredTokens = {
  accessToken: string
  refreshToken: string
  /** epoch ms */
  expiresAt: number
}

/**
 * expo-secure-store 가 만족하는 최소 인터페이스.
 * 이 모듈은 expo-secure-store 를 직접 import 하지 않는다 — 호출부(native 진입점)가
 * 실제 SecureStore 를 주입하고, 테스트는 인메모리 fake 를 주입한다.
 */
export type SecureBackend = {
  getItemAsync(key: string): Promise<string | null>
  setItemAsync(key: string, value: string): Promise<void>
  deleteItemAsync(key: string): Promise<void>
}

export type TokenStore = {
  read(): Promise<StoredTokens | null>
  write(tokens: StoredTokens): Promise<void>
  clear(): Promise<void>
}

const KEY = "almondyoung.tokens"

/**
 * JSON.parse 는 문법 오류만 잡아준다 — `"{}"` 처럼 문법은 멀쩡하지만 필드가
 * 빠지거나 타입이 다른 값도 그대로 통과시킨다. 이 함수가 그 경계에서 실제
 * 필드 타입까지 검증한다. `as Record<string, unknown>` 은 unknown 값의 속성을
 * 프로브하기 위한 타입가드 내부의 좁히기 캐스트로, 검증 결과 없이 바깥으로
 * 새어나가지 않는다.
 */
function isStoredTokensShape(value: unknown): value is StoredTokens {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.accessToken === "string" &&
    typeof record.refreshToken === "string" &&
    typeof record.expiresAt === "number"
  )
}

export function createTokenStore(backend: SecureBackend): TokenStore {
  return {
    async read() {
      const raw = await backend.getItemAsync(KEY)
      if (!raw) return null
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return null
      }
      return isStoredTokensShape(parsed) ? parsed : null
    },
    async write(tokens) {
      await backend.setItemAsync(KEY, JSON.stringify(tokens))
    },
    async clear() {
      await backend.deleteItemAsync(KEY)
    },
  }
}

const DEFAULT_SKEW_MS = 30_000

/** now(ms) 기준으로 skewMs 여유를 두고 만료 여부를 판정한다. */
export function isExpired(
  tokens: StoredTokens,
  now: number,
  skewMs: number = DEFAULT_SKEW_MS
): boolean {
  return tokens.expiresAt <= now + skewMs
}
