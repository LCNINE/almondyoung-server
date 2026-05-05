import { InterestSelectorBanner } from "@/domains/home/components/interest/interest-selector-banner"
import {
  getInterestBannerDismissed,
  getInterestCategoryKeys,
} from "@lib/data/cookies"
import { InterestProductsList } from "./interest-products-list"

interface InterestCategoriesSlotProps {
  countryCode: string
}

/*───────────────────────────
 * 홈 상단 슬롯 — 쿠키 분기로 다음 셋 중 하나를 렌더:
 *  1. 미선택 + dismiss 안됨  → InterestSelectorBanner
 *  2. 미선택 + dismiss 됨    → null (1주일 동안 안 보임)
 *  3. 선택값 1~3개 있음      → InterestProductsList (해당 카테고리 베스트 섹션들)
 *──────────────────────────*/
export async function InterestCategoriesSlot({
  countryCode,
}: InterestCategoriesSlotProps) {
  const selectedKeys = await getInterestCategoryKeys()

  if (selectedKeys.length === 0) {
    const dismissed = await getInterestBannerDismissed()
    if (dismissed) return null
    return <InterestSelectorBanner />
  }

  return (
    <InterestProductsList
      countryCode={countryCode}
      selectedKeys={selectedKeys}
    />
  )
}
