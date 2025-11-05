import { fetchCurrentUser } from "@lib/api/users"
import { CategorySelectSection } from "../../../../legacy/sections/yourCategory-section"
import HeroBannerSlider from "../components/banner/heroBannerSlider"
import { HomeLoggedIn } from "../home-loggedin"
import { HomeLogout } from "../home-logout"

export default async function HomeTemplate({
  countryCode,
}: {
  countryCode: string
}) {
  const user = await fetchCurrentUser()

  return (
    <>
      <HeroBannerSlider slides={[]} />

      {user ? <HomeLoggedIn user={user} /> : <HomeLogout categories={[]} />}
      <CategorySelectSection countryCode={countryCode} />
    </>
  )
}
