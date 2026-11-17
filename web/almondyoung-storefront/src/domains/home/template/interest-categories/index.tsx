import { getBestProductsByCategory } from "@/domains/home/actions"
import { InterestSelectorBanner } from "@/domains/home/components/interest/interest-selector-banner"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getRegion } from "@/lib/api/medusa/regions"
import { getWishlist } from "@/lib/api/users/wishlist"
import { INTEREST_CANDIDATE_CATEGORIES } from "@/lib/constants/categories"
import {
  getInterestBannerDismissed,
  getInterestCategoryKeys,
} from "@lib/data/cookies"

interface InterestCategoriesSlotProps {
  countryCode: string
}

export async function isInterestBannerVisible(): Promise<boolean> {
  return !(await getInterestBannerDismissed())
}

/*───────────────────────────
 * 홈 관심 분야 슬롯. 1주일 보지 않기를 눌렀으면 비운다.
 * 후보 분야 베스트를 한 번에 받아 두고, 고르는 즉시 화면에서 섞어 보여준다.
 *──────────────────────────*/
export async function InterestCategoriesSlot({
  countryCode,
}: InterestCategoriesSlotProps) {
  if (await getInterestBannerDismissed()) return null

  const [selectedKeys, region, customer] = await Promise.all([
    getInterestCategoryKeys(),
    getRegion(countryCode),
    retrieveCustomer(),
  ])

  const [wishlist, bestLists] = await Promise.all([
    customer ? getWishlist().catch(() => []) : Promise.resolve([]),
    Promise.all(
      INTEREST_CANDIDATE_CATEGORIES.map((cat) =>
        getBestProductsByCategory({
          handle: cat.handle,
          regionId: region?.id,
          limit: 10,
        }).catch(() => [])
      )
    ),
  ])

  const bestByKey = Object.fromEntries(
    INTEREST_CANDIDATE_CATEGORIES.map((cat, i) => [cat.key, bestLists[i]])
  )

  return (
    <InterestSelectorBanner
      initialKeys={selectedKeys}
      bestByKey={bestByKey}
      customer={customer}
      wishlistIds={wishlist.map((item) => item.productId)}
    />
  )
}
