// wallet-web 판. storefront 원본(src/lib/data/cookies.ts)에서 체크아웃이 실제로 쓰는 것만 남겼다.
//
// 원본과 다른 점:
//  1. 인증 토큰은 storefront 의 `_medusa_jwt` 가 아니라 핸드오프로 받아둔 `wallet_mjwt` 다.
//     (같은 이름을 쓰면 storefront 가 부모 도메인에 박는 쿠키와 충돌한다 — session-cookies.ts 주석)
//  2. 카트 id 는 핸드오프로 고정돼 있어 wallet-web 이 갈아끼우지 않는다. set/remove 는 no-op.
//  3. 캐시 태그에 cache-id 를 붙이지 않는다. 체크아웃은 전부 no-store 로 읽어 캐시할 것이 없고,
//     이식 코드의 revalidateTag 호출은 아무도 구독하지 않는 태그를 무효화할 뿐이라 무해하다.
import "server-only"

import { getCheckoutCartId, getMedusaJwt } from "@/lib/auth/session-cookies"
import { getMedusaAuthHeaders } from "@/lib/medusa"

export const getAuthHeaders = async (): Promise<{ authorization: string } | null> =>
  getMedusaAuthHeaders()

export const getCacheTag = async (tag: string): Promise<string> => tag

export const getCacheOptions = async (
  _tag: string
): Promise<{ tags: string[] } | Record<string, never>> => ({})

export const getCartId = async (): Promise<string | undefined> =>
  (await getCheckoutCartId()) ?? undefined

// 핸드오프로 넘어온 카트 하나만 다루므로 쿠키를 바꿀 일이 없다.
export const setCartId = async (_cartId: string): Promise<void> => {}
export const removeCartId = async (): Promise<void> => {}

// 세션 만료 정리는 wallet-web 자체 경로(lib/auth-expired.ts)가 담당한다.
export const removeAccessToken = async (): Promise<void> => {}
export const removeRefreshToken = async (): Promise<void> => {}

export const getAccessToken = async (): Promise<string | undefined> =>
  (await getMedusaJwt()) ?? undefined
