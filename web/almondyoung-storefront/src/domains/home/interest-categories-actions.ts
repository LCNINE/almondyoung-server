"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { api } from "@/lib/api/api"
import {
  getAccessToken,
  removeInterestBannerDismissed,
  setInterestBannerDismissed7Days,
  setInterestCategoryKeys,
} from "@lib/data/cookies"
import {
  INTEREST_CANDIDATE_KEYS,
  MAX_INTEREST_CATEGORIES,
} from "@/lib/constants/categories"

const interestKeysSchema = z
  .array(z.enum(INTEREST_CANDIDATE_KEYS))
  .max(MAX_INTEREST_CATEGORIES, `최대 ${MAX_INTEREST_CATEGORIES}개까지 선택할 수 있습니다.`)

/**
 * 관심 카테고리 선택 저장.
 * - 로그인 사용자: user-service PATCH + 쿠키 동기화
 * - 비로그인 사용자: 쿠키만 저장
 * 호출 측은 인증 분기를 신경쓰지 않는다.
 */
export async function updateInterestCategories(keys: string[]): Promise<void> {
  const parsed = interestKeysSchema.parse(
    Array.from(new Set(keys)).slice(0, MAX_INTEREST_CATEGORIES)
  )

  const accessToken = await getAccessToken()

  if (accessToken) {
    await api("users", "/users/me", {
      method: "PATCH",
      body: { interestCategoryKeys: parsed },
      withAuth: true,
    })
  }

  await setInterestCategoryKeys(parsed)

  // 선택을 저장했으면 dismiss 상태도 의미가 사라지므로 함께 정리
  await removeInterestBannerDismissed()

  // MainHeader / 홈 슬롯이 layout/page 캐시에 묶여 있으므로 layout 무효화
  revalidatePath("/[countryCode]", "layout")
}

/**
 * "1주일간 보지 않음" — 배너만 숨김. 선택값/서버 prefs 는 건드리지 않음.
 */
export async function dismissInterestBanner7Days(): Promise<void> {
  await setInterestBannerDismissed7Days()
  revalidatePath("/[countryCode]", "layout")
}
