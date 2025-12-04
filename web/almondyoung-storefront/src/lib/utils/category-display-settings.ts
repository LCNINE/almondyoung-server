import type { CategoryDisplaySettings, PimCategory } from "@lib/api/pim/pim-types"

/**
 * display_settings JSON 문자열을 파싱하여 CategoryDisplaySettings 객체로 변환
 */
export function parseDisplaySettings(
  displaySettings?: string | CategoryDisplaySettings | null
): CategoryDisplaySettings | null {
  if (!displaySettings) {
    return null
  }

  // 이미 객체인 경우
  if (typeof displaySettings === "object" && !Array.isArray(displaySettings)) {
    return displaySettings as CategoryDisplaySettings
  }

  // JSON 문자열인 경우 파싱
  if (typeof displaySettings === "string") {
    try {
      return JSON.parse(displaySettings) as CategoryDisplaySettings
    } catch (error) {
      console.warn("[parseDisplaySettings] JSON 파싱 실패:", error, displaySettings)
      return null
    }
  }

  return null
}

/**
 * 카테고리에서 showOnMainCategory 값을 가져옴
 */
export function getShowOnMainCategory(category: PimCategory): boolean {
  // displaySettings (camelCase, 이미 파싱된 객체) 우선 확인
  if ("displaySettings" in category && category.displaySettings) {
    const settings = parseDisplaySettings(category.displaySettings)
    return settings?.showOnMainCategory === true
  }

  // display_settings (snake_case, JSON 문자열) 확인 (하위 호환성)
  if ("display_settings" in category && category.display_settings) {
    const settings = parseDisplaySettings(category.display_settings)
    return settings?.showOnMainCategory === true
  }

  return false
}

