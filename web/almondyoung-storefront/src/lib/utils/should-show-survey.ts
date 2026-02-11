import type { UserDetailDto } from "@/lib/types/dto/users"

/**
 * 설문 표시 여부를 판단합니다.
 *
 * 다음 조건 중 하나라도 만족하면 설문을 표시합니다:
 * 1. 샵 정보가 없는 경우
 * 2. 카테고리가 없고, 리마인드 시간이 도래한 경우
 */
export function shouldShowSurvey(user: UserDetailDto | null): boolean {
  // 샵 정보가 없는 경우 -> 설문 표시
  if (!user?.shop) return true

  // 카테고리가 이미 있으면 -> 설문 완료, 숨김
  const hasCategories = user.shop.categories && user.shop.categories.length > 0
  if (hasCategories) return false

  // 카테고리 없고, 리마인드 시간이 도래한 경우 -> 설문 표시
  // remind_at이 null = 아직 건너뛰기 안함 -> 설문 표시
  // remind_at이 현재시간 이전 = 리마인드 시간 도래 -> 설문 표시
  const isReminderDue =
    !user.shop.remind_at || new Date(user.shop.remind_at) <= new Date()

  return isReminderDue
}
