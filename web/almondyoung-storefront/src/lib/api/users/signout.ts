/**
 * 사용자 로그아웃을 처리합니다.
 * - 백엔드 세션 종료
 * - Medusa 인증 종료
 * - 모든 쿠키 제거
 * - 캐시 무효화
 */
export async function signout(): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch("/api/auth/signout", {
      method: "POST",
      credentials: "include",
    })

    if (!response.ok) {
      throw new Error("로그아웃 처리 중 오류가 발생했습니다.")
    }

    if (response.redirected) {
      window.location.href = response.url
      return { success: true }
    }

    return { success: true }
  } catch (error) {
    console.error("Signout error:", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "알 수 없는 오류",
    }
  }
}
