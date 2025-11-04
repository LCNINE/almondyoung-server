// --- Layout & Module Components ---
import HeroBannerSlider from "domains/home/components/banner/heroBannerSlider"
// --- API & Types ---
import ClientToast from "@components/common/client-toast"
import { ThemeManager } from "@components/common/theme-manager"
import { fetchCurrentUser } from "@lib/api/users"

import { CategorySelectSection } from "../../../../legacy/sections/yourCategory-section"
import { HomeLogout } from "domains/home/home-logout"
import { HomeLoggedIn } from "domains/home/home-loggedin"
import { WithHeaderLayout } from "@components/layout"

export default async function Home(props: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params

  let serverErrorMessage: string | null = null

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: true,
      }}
    >
      <ClientToast message={serverErrorMessage} type="error" />
      <HeroBannerSlider slides={[]} />
      <HomeLogout categories={[]} />
      {/* <HomeLoggedIn user={null} /> */}
      <CategorySelectSection countryCode={countryCode} />
      {/* 테마 매니저 (개발 모드에서만 표시) */}
      {process.env.NODE_ENV === "development" && <ThemeManager />}
    </WithHeaderLayout>
  )
}
