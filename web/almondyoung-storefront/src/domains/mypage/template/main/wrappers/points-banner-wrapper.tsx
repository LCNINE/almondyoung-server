import { getPointBalance } from "@lib/api/wallet"
import { PointsBanner } from "../../../components/mobile/points-banner"
import type { PointBalanceData } from "../../../types/mypage-types"

export async function PointsBannerWrapper() {
  const pointData: PointBalanceData = await getPointBalance()

  return <PointsBanner initialData={pointData} />
}
