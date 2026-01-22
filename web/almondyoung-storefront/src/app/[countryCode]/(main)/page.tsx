import { ThemeManager } from "@/components/shared/theme-manager"
import { HomeLoggedInTemplate } from "@/domains/home/template/home-loggedin-template"
import { getRegion } from "@/lib/api/medusa/regions"
import { siteConfig } from "@/lib/config/site"
import { getSEOTags } from "@/lib/seo"
import ProtectedRoute from "@components/protected-route"
import { getCategoryTree } from "@lib/api/pim"
import { fetchMe } from "@lib/api/users/me"
import type { CategoryTreeNodeDto } from "@lib/types/dto/pim"
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
  const region = await getRegion(countryCode)

  // 카테고리 트리 조회
  let categories: CategoryTreeNodeDto[] = []

  const result = await getCategoryTree().catch(() => null)
  categories = result?.categories || []

  // const user = await fetchMe().catch(() => null)

  return (
    <ProtectedRoute>
      {/* {user ? (
        <HomeLoggedInTemplate user={user} />
      ) : (
        <HomeLogoutTemplate initialCategories={categories} />
      )} */}
      <HomeLogoutTemplate
        initialCategories={categories}
        regionId={region?.id}
      />

      {/* 테마 매니저 (개발 모드에서만 표시) */}
      {process.env.NODE_ENV === "development" && <ThemeManager />}
    </ProtectedRoute>
  )
}
