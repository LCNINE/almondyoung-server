import { ApiAuthError, ApiNetworkError } from "@lib/api-error"
import { fetchCurrentUser } from "@lib/api/users"
import HeroBannerSlider from "../components/banner/heroBannerSlider"
import { HomeLoggedIn } from "../home-loggedin"
import { HomeLogout } from "../home-logout"

export default async function HomeTemplate({
  countryCode,
}: {
  countryCode: string
}) {
  // 비로그인 유저도 접근 가능 - 에러 시 null 처리
  let user = null
  try {
    user = await fetchCurrentUser()
  } catch (e) {
    // ApiAuthError와 ApiNetworkError는 무시 (비로그인 상태 또는 네트워크 문제)
    // ProtectedRoute에서 이미 네트워크 에러 토스트를 처리함
    if (e instanceof ApiAuthError || e instanceof ApiNetworkError) {
      // user는 null로 유지
    } else {
      // 그 외 에러는 상위로 전달
      throw e
    }
  }

  return (
    <>
      <HeroBannerSlider slides={[]} />

      {user ? <HomeLoggedIn user={user} /> : <HomeLogout categories={[]} />}
    </>
  )
}
