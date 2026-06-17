import { getBaseURL } from "@lib/utils/env"
import { Metadata } from "next"
import { MainHeader } from "../../../components/layout/header/main-header"
import { NoticePopup } from "@/components/layout/notice-popup"
import { getMyProfile } from "@/lib/api/users/profile"
import { siteConfig } from "@/lib/config/site"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
  title: {
    default: `${siteConfig.appName} | 최저가 미용재료 MRO 쇼핑몰`,
    template: "%s | 아몬드영",
  },
}

export default async function MainLayout(props: { children: React.ReactNode }) {
  const user = await getMyProfile().catch(() => null)
  return (
    <div className="flex min-h-screen flex-col">
      <MainHeader />
      {props.children}
      <NoticePopup isLoggedIn={!!user} />
    </div>
  )
}
