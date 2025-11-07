"use client"

import { useUser } from "contexts/user-context"
import HeroBannerSlider from "../components/banner/heroBannerSlider"
import { HomeLoggedIn } from "../home-loggedin"
import { HomeLogout } from "../home-logout"

export default function HomeTemplate({ countryCode }: { countryCode: string }) {
  const { user } = useUser()

  return (
    <>
      <HeroBannerSlider slides={[]} />

      {user ? <HomeLoggedIn user={user} /> : <HomeLogout categories={[]} />}
    </>
  )
}
