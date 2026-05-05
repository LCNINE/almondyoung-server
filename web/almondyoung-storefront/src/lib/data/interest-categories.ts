import "server-only"

import { getMyProfile } from "@/lib/api/users/profile"
import {
  removeInterestBannerDismissed,
  removeInterestCategoryKeys,
  setInterestCategoryKeys,
} from "./cookies"

/**
 * 로그인 직후 user-service 의 prefs 를 anon 쿠키와 동기화한다.
 *
 * - 서버에 값이 있으면 → 쿠키 덮어쓰기 (anon 선택값은 무시)
 * - 서버에 값이 비어있으면 → 쿠키/dismiss 모두 비움 (계정 단위로 다시 묻기)
 * - getMyProfile 503 등 일시 실패 → 그대로 두고 종료 (다음 요청에서 SSR 이 재시도)
 *
 * 호출은 setTokenCookies() 직후, 즉 토큰이 막 set 되어 api 호출이 가능한 시점에
 * 이루어져야 한다.
 */
export async function syncInterestPrefsFromServer(): Promise<void> {
  try {
    const profile = await getMyProfile()
    const serverKeys = profile?.profile?.interestCategoryKeys ?? null

    if (Array.isArray(serverKeys) && serverKeys.length > 0) {
      await setInterestCategoryKeys(serverKeys)
      await removeInterestBannerDismissed()
      return
    }

    // 비어있음 — anon 쿠키/dismiss 모두 정리해서 배너 다시 노출되도록
    await removeInterestCategoryKeys()
    await removeInterestBannerDismissed()
  } catch (error) {
    console.warn(
      "[syncInterestPrefsFromServer] failed",
      (error as Error).message
    )
  }
}
