import { getBaseURL } from "@lib/utils/env"
import { Metadata } from "next"
import { Suspense } from "react"
import { MainHeader } from "../../../components/layout/header/main-header"
import { SitePopupHost } from "@/components/layout/site-popup/site-popup-host"
import { siteConfig } from "@/lib/config/site"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
  // 브랜드명은 루트 레이아웃의 template(`%s | 아몬드영`)이 붙여준다. 여기서 또 넣으면
  // `아몬드영 | … | 아몬드영` 이 된다.
  title: {
    default: "최저가 미용재료 MRO 쇼핑몰",
    template: `%s | ${siteConfig.appName}`,
  },
}

export default async function MainLayout(props: {
  children: React.ReactNode
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params

  return (
    <div className="flex min-h-screen flex-col">
      <MainHeader />
      {props.children}
      {/* 팝업 조회가 페이지 본문 렌더를 막지 않도록 분리한다. */}
      <Suspense fallback={null}>
        <SitePopupHost countryCode={countryCode} />
      </Suspense>
    </div>
  )
}
