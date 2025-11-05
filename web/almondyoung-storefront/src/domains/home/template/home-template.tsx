import { ApiAuthError } from "@lib/api-error"
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
    // ApiAuthError는 무시 (비로그인 상태)
    if (!(e instanceof ApiAuthError)) {
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
