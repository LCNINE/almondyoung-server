import { ThemeManager } from "@components/common/theme-manager"
import ProtectedRoute from "@components/protected-route"
import { CategoryTreeNodeDto, getCategoryTree } from "@lib/api/pim"
import { fetchMe } from "@lib/api/users/me"
import { HomeLogoutTemplate } from "domains/home/template/home-logout-template"
import { Metadata } from "next"

export const metadata: Metadata = {
  title: "아몬드영 | 최저가 미용재료 MRO 쇼핑몰",
  description:
    "속눈썹, 네일, 왁싱, 반영구, 헤어, 피부미용 등 전문 미용재료를 최저가로 빠르게! 원장님들을 위한 전문가 전용 MRO 쇼핑몰 아몬드영입니다.",
  keywords: [
    "미용재료",
    "왁싱재료",
    "속눈썹부자재",
    "네일아트재료",
    "반영구재료",
    "미용소모품",
    "MRO쇼핑몰",
    "아몬드영",
  ],
  openGraph: {
    title: "아몬드영 - 전문가를 위한 미용재료 최저가 쇼핑몰",
    description:
      "속눈썹부터 왁싱까지, 모든 미용 재료를 가장 합리적인 가격에 만나보세요.",
    url: "https://almondyoung.com", // todo:실제 도메인으로 변경 필요
    siteName: "아몬드영",
    images: [
      {
        url: "/og-image.png", // todo: public 폴더에 위치한 대표 이미지 경로
        width: 1200,
        height: 630,
        alt: "아몬드영 미용재료 쇼핑몰",
      },
    ],
    locale: "ko_KR",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  },
  viewport: "width=device-width, initial-scale=1",
}
export default async function Home() {
  // 카테고리 트리 조회
  let categories: CategoryTreeNodeDto[] = []

  const result = await getCategoryTree().catch(() => null)
  categories = result?.categories || []

  // const productList = await getProductList().catch(() => null)

  // todo: 로그인 사용자용 홈페이지 섹션들
  const user = await fetchMe().catch(() => null)

  return (
    <ProtectedRoute>
      <HomeLogoutTemplate initialCategories={categories} />

      {/* 테마 매니저 (개발 모드에서만 표시) */}
      {process.env.NODE_ENV === "development" && <ThemeManager />}
    </ProtectedRoute>
  )
}
