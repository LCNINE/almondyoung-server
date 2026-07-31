import { ThemeManager } from "@/components/shared/theme-manager"
import { SurveyPromptBanner } from "@/components/survey-prompt-banner"
// import { Cafe24LinkBanner } from "@/components/cafe24-link-banner"
// import { Cafe24LinkPopup } from "@/components/layout/cafe24-link-popup"
import { getMyProfile } from "@/lib/api/users/profile"
import { siteConfig } from "@/lib/config/site"
import { getSEOTags } from "@/lib/seo"
import { shouldShowSurvey } from "@/lib/utils/should-show-survey"
import { getTranslations } from "next-intl/server"
import ProtectedRoute from "@components/protected-route"
import { HomeLogoutTemplate } from "domains/home/template/home-logout-template"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await params

  return getSEOTags({
    title: `${siteConfig.appName} | 최저가 미용재료 MRO 쇼핑몰`,
    openGraph: {},
    canonicalUrlRelative: `/${countryCode}`,
    extraTags: {},
  })
}

export default async function Home({
  params,
}: {
  params: { countryCode: string }
}) {
  const { countryCode } = await params
  const [userDetailInfo, t] = await Promise.all([
    getMyProfile().catch(() => null),
    getTranslations("home"),
  ])
  const showSurvey: boolean = shouldShowSurvey(userDetailInfo)

  const isLoggedIn = !!userDetailInfo

  return (
    <ProtectedRoute>
      {/* 홈의 문서 제목. 화면에는 안 보이지만 크롤러·스크린리더는 읽는다.
          섹션 제목들은 h2 가 맞으므로 h1 은 여기 하나만 둔다. */}
      <h1 className="sr-only">{t("pageTitle")}</h1>

      <HomeLogoutTemplate countryCode={countryCode} />

      {/* 설문 유도 배너 */}
      {showSurvey && <SurveyPromptBanner countryCode={countryCode} />}

      {/* 카페24 계정 미연동 유저 대상 연동 권장 팝업 + 배너 (연동 여부는 클라이언트에서 확인) */}
      {/* {isLoggedIn && <Cafe24LinkPopup countryCode={countryCode} />} */}
      {/* {isLoggedIn && <Cafe24LinkBanner countryCode={countryCode} />} */}

      {/* 테마 매니저 (개발 모드에서만 표시) */}
      {process.env.NODE_ENV === "development" && <ThemeManager />}
    </ProtectedRoute>
  )
}
