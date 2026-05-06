import { getPointBalance } from "@lib/api/wallet"
import { PointsBanner } from "../../../components/mobile/points-banner"
import type { PointBalanceData } from "../../../types/mypage-types"
import { withMypageTimeout } from "./mypage-timeout"

export async function PointsBannerWrapper() {
  const pointData: PointBalanceData = await withMypageTimeout(
    getPointBalance(),
    {
      available: 0,
      confirmed: 0,
      reserved: 0,
    }
  )

  return <PointsBanner initialData={pointData} />
}
