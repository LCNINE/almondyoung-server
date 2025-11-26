/**
 * Wallet 서버 사이드 API 클라이언트
 * 서버 컴포넌트에서 사용할 때는 쿠키를 수동으로 전달해야 합니다.
 */

const API_BASE = "/api/wallet"

/**
 * 결제 프로필 목록 조회 (서버 사이드)
 * @param cookies 쿠키 문자열 (request.cookies.toString())
 */
export async function getPaymentProfilesServer(cookies?: string) {
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
  
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  }
  
  if (cookies) {
    headers["Cookie"] = cookies
  }

  const res = await fetch(`${appUrl}${API_BASE}/payments/profiles`, {
    method: "GET",
    headers,
    cache: "no-store",
  })

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Unknown error" }))
    throw new Error(error.message || `Failed to fetch payment profiles: ${res.statusText}`)
  }

  return res.json()
}

