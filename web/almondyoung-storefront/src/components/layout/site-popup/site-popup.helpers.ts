import type { SitePopup } from "@/lib/types/ui/site-popup"

/** 관리자가 크기를 비워둘 때의 기본 폭. 어드민 미리보기와 같은 값이어야 한다. */
export const DEFAULT_PC_WIDTH = 460
export const DEFAULT_MOBILE_WIDTH = 340

const DISMISS_KEY_PREFIX = "popup:"

/**
 * `/kr/products/foo` → `/products/foo`.
 * 관리자는 국가 코드를 빼고 경로를 입력하므로, 매칭 전에 접두사를 벗긴다.
 */
export function stripCountryCode(pathname: string, countryCode: string): string {
  const prefix = `/${countryCode}`
  if (pathname === prefix) return "/"
  if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length)
  return pathname
}

export function matchesPath(popup: SitePopup, path: string): boolean {
  if (popup.placement === "all") return true
  if (popup.placement === "main") return path === "/" || path === ""
  return popup.placementPaths.some(
    (target) => path === target || path.startsWith(`${target}/`)
  )
}

/** 숨김 키에 버전을 섞어, 관리자가 숨김을 초기화하면 이미 닫은 사람에게도 다시 뜬다. */
function dismissKey(popup: SitePopup): string {
  return `${DISMISS_KEY_PREFIX}${popup.id}:v${popup.dismissVersion}`
}

export function isPopupDismissed(popup: SitePopup): boolean {
  if (popup.dismissMode === "none") return false
  if (typeof window === "undefined") return false

  try {
    const hideUntil = window.localStorage.getItem(dismissKey(popup))
    return hideUntil !== null && Date.now() < Number(hideUntil)
  } catch {
    // 사생활 보호 모드 등에서 localStorage 접근이 막히면 그냥 노출한다.
    return false
  }
}

export function dismissPopup(popup: SitePopup): void {
  if (typeof window === "undefined") return

  const hideUntil =
    popup.dismissMode === "days"
      ? Date.now() + Math.max(1, popup.dismissDays ?? 1) * 24 * 60 * 60 * 1000
      : endOfToday()

  try {
    // 같은 팝업의 옛 버전 키가 남아 쌓이지 않게 정리한다.
    const stalePrefix = `${DISMISS_KEY_PREFIX}${popup.id}:`
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(stalePrefix)) window.localStorage.removeItem(key)
    }
    window.localStorage.setItem(dismissKey(popup), String(hideUntil))
  } catch {
    // 저장에 실패하면 다음 방문에 다시 뜰 뿐이라 무시한다.
  }
}

function endOfToday(): number {
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  return end.getTime()
}

/**
 * 관리자가 지정한 px 크기를 실제 스타일로 바꾼다.
 * 높이를 비우면 내용에 맞춰 자동, 너비가 화면보다 넓으면 화면 안으로 줄어든다.
 */
export function resolvePopupSize(
  popup: SitePopup,
  isDesktop: boolean
): { width: number; height: number | null } {
  if (isDesktop) {
    return {
      width: popup.pcWidth ?? DEFAULT_PC_WIDTH,
      height: popup.pcHeight,
    }
  }

  return {
    width: popup.mobileWidth ?? DEFAULT_MOBILE_WIDTH,
    height: popup.mobileHeight,
  }
}

/** 사이트 밖으로 나가는 링크인지. 내부 경로는 LocalizedClientLink 로 보내야 한다. */
export function isExternalLink(url: string): boolean {
  return /^https?:\/\//i.test(url.trim())
}
