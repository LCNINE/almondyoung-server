import { ThemeManager } from "@components/common/theme-manager"
import { WithHeaderLayout } from "@components/layout"
import ProtectedRoute from "@components/protected-route"
import HomeTemplate from "domains/home/template/home-template"
import { CategorySelectSection } from "../../../../legacy/sections/yourCategory-section"

export default async function Home(props: {
  params: Promise<{ countryCode: string }>
}) {
  const { countryCode } = await props.params

  return (
    <ProtectedRoute>
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: true,
        }}
      >
        <HomeTemplate countryCode={countryCode} />
        <CategorySelectSection countryCode={countryCode} />

        {/* 테마 매니저 (개발 모드에서만 표시) */}
        {process.env.NODE_ENV === "development" && <ThemeManager />}
      </WithHeaderLayout>
    </ProtectedRoute>
  )
}
