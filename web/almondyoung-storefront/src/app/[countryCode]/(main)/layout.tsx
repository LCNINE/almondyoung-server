import { getBaseURL } from "@lib/utils/env"
import { Metadata } from "next"
import { MainHeader } from "../../../components/layout/header/main-header"
import { siteConfig } from "@/lib/config/site"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
  title: {
    default: `${siteConfig.appName} | 최저가 미용재료 MRO 쇼핑몰`,
    template: "%s | 아몬드영",
  },
}

export default function MainLayout(props: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <MainHeader />
      {props.children}
    </div>
  )
}
