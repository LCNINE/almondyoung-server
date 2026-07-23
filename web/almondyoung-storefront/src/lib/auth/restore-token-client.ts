import {
  extractCountryCodeFromPath,
  normalizeRedirectPath,
  toLocalizedPath,
} from "@/lib/utils/locale-path"

/**
 * 진행 중인 재발급 요청. 동시에 401 이 여러 개 떠도 refresh token 회전이 한 번만
 * 일어나도록 공유한다 (동시 회전은 "reuse detected" 로 세션 전체가 폐기됨).
 * 탭 단위 dedupe — 여러 탭이 동시에 만료되는 경우는 여기서는 안막음
 */
let inflightRestore: Promise<boolean> | null = null

/**
 * 만료된 accessToken 을 refresh token 으로 재발급한다 (클라이언트에서 호출).
 *
 * error.tsx 의 복구 경로는 페이지 전체를 리로드하므로, 클릭 한 번으로 끝나야 하는
 * 액션(다운로드 등)에서는 이 함수로 제자리 재발급 후 재시도한다.
 *
 * @returns true = 재발급 성공(재시도 가능), false = 실패해서 로그인 페이지로 보냄
 */
export function restoreTokenOrRedirect(): Promise<boolean> {
  inflightRestore ??= doRestoreTokenOrRedirect().finally(() => {
    inflightRestore = null
  })
  return inflightRestore
}

async function doRestoreTokenOrRedirect(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/restore-token", {
      method: "POST",
      credentials: "include",
    })
    if (res.ok) return true
  } catch {
    // 네트워크 실패도 로그인 유도로 처리
  }

  const path = window.location.pathname
  const loginPath = toLocalizedPath(
    extractCountryCodeFromPath(path, "kr"),
    "/login"
  )
  const redirectTo = encodeURIComponent(
    normalizeRedirectPath(path + window.location.search)
  )
  window.location.href = `${loginPath}?redirect_to=${redirectTo}`
  return false
}

/**
 * `{ success, unauthorized }` 형태를 반환하는 서버 액션을, 토큰 만료면 재발급 후
 * 딱 한 번 재시도해서 호출한다. 재발급 실패 시엔 로그인 페이지로 이동한다.
 */
export async function withTokenRetry<
  T extends { success: boolean; unauthorized?: boolean },
>(fn: () => Promise<T>): Promise<T> {
  const res = await fn()
  if (res.success || !res.unauthorized) return res
  if (!(await restoreTokenOrRedirect())) return res
  return fn()
}
