import { sortBy } from "lodash"
import { BannerDto } from "../types/dto/pim"
import type { BannerGroupDto } from "../types/dto/pim"

/**
 * 그룹째로 노출 가능한지. 그룹을 비활성화하면 안에 활성 배너가 남아 있어도 노출되지 않아야 한다.
 *
 * 타입 가드로 둬서 호출부에서 early return 후 그룹을 non-null 로 쓸 수 있게 한다.
 */
export function isBannerGroupVisible<
  T extends Pick<BannerGroupDto, "isActive" | "deletedAt">,
>(group: T | null | undefined): group is T {
  return !!group && group.isActive && !group.deletedAt
}

/**
 * 배너 그룹 내에서 현재 노출 가능한 활성 배너만 필터링하고 정렬합니다.
 */
export function getActiveBanners(banners: BannerDto[] = []): BannerDto[] {
  const now = new Date().getTime()

  return sortBy(banners, ["sortOrder"]).filter((banner) => {
    const start = banner.displayStartAt
      ? new Date(banner.displayStartAt).getTime()
      : 0
    const end = banner.displayEndAt
      ? new Date(banner.displayEndAt).getTime()
      : Infinity

    return banner.isActive && start <= now && end >= now
  })
}
