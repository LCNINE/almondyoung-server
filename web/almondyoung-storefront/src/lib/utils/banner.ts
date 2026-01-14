import { sortBy } from "lodash"
import { BannerDto } from "../types/dto/pim"

/**
 * 배너 그룹 내에서 현재 노출 가능한 활성 배너만 필터링하고 정렬합니다.
 */
export function getActiveBanners(banners: BannerDto[] = []): BannerDto[] {
  const now = new Date().getTime()

  return sortBy(banners, ["sortOrder"]).filter((banner) => {
    const start = new Date(banner.displayStartAt ?? 0).getTime()
    const end = new Date(banner.displayEndAt ?? 0).getTime()

    return banner.isActive && start <= now && end >= now
  })
}
