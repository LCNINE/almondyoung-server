import { ThemeType } from "@lib/providers/custom-theme-provider"

/**
 * 테마를 동적으로 변경하는 유틸리티 함수들
 */

/**
 * 현재 테마를 가져옵니다
 */
export function getCurrentTheme(): ThemeType {
  if (typeof window === "undefined") return "light"

  const bodyClass = document.body.className
  const themes: ThemeType[] = [
    "light",
    "black-friday",
    "valentine",
    "christmas",
  ]

  for (const theme of themes) {
    if (bodyClass.includes(theme)) {
      return theme
    }
  }

  return "light"
}

/**
 * 테마를 변경합니다
 */
export function setTheme(theme: ThemeType): void {
  if (typeof window === "undefined") return

  // 기존 테마 클래스 제거
  const themes: ThemeType[] = [
    "light",
    "black-friday",
    "valentine",
    "christmas",
  ]
  themes.forEach((t) => {
    document.body.classList.remove(t)
    document.documentElement.classList.remove(t)
  })

  // 새 테마 클래스 추가
  document.body.classList.add(theme)
  document.documentElement.classList.add(theme)

  // 로컬 스토리지에 저장
  localStorage.setItem("custom-theme", theme)
}

/**
 * 저장된 테마를 복원합니다
 */
export function restoreTheme(): ThemeType {
  if (typeof window === "undefined") return "light"

  const savedTheme = localStorage.getItem("custom-theme") as ThemeType
  if (
    savedTheme &&
    ["light", "black-friday", "valentine", "christmas"].includes(savedTheme)
  ) {
    setTheme(savedTheme)
    return savedTheme
  }

  return "light"
}

/**
 * 특별 이벤트 테마를 설정합니다 (예: 블랙프라이데이)
 */
export function setEventTheme(
  eventType: "black-friday" | "valentine" | "christmas"
): void {
  setTheme(eventType)
}

/**
 * 기본 테마로 복원합니다
 */
export function resetToDefaultTheme(): void {
  setTheme("light")
}

/**
 * 현재 테마가 특별 테마인지 확인합니다
 */
export function isSpecialTheme(theme?: ThemeType): boolean {
  const currentTheme = theme || getCurrentTheme()
  return currentTheme !== "light"
}
