import { ThemeManager } from "@/components/shared/theme-manager"
import { SurveyPromptBanner } from "@/components/survey-prompt-banner"
import { siteConfig } from "@/lib/config/site"
import { getSEOTags } from "@/lib/seo"
import { shouldShowSurvey } from "@/lib/utils/should-show-survey"
import ProtectedRoute from "@components/protected-route"
import { fetchMe } from "@lib/api/users/me"
import { HomeLogoutTemplate } from "domains/home/template/home-logout-template"

export const metadata = getSEOTags({
  title: `${siteConfig.appName} | 최저가 미용재료 MRO 쇼핑몰`,
  openGraph: {},
  extraTags: {},
})

export default async function Home({
  params,
}: {
  params: { countryCode: string }
}) {
  const { countryCode } = await params
  const user = await fetchMe().catch(() => null)
  const showSurvey: boolean = shouldShowSurvey(user)

  return (
    <ProtectedRoute>
      <HomeLogoutTemplate user={user} countryCode={countryCode} />

      {/* 설문 유도 배너 */}
      {showSurvey && <SurveyPromptBanner countryCode={countryCode} />}

      {/* 테마 매니저 (개발 모드에서만 표시) */}
      {process.env.NODE_ENV === "development" && <ThemeManager />}
    </ProtectedRoute>
  )
}
