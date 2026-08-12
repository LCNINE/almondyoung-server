import { SiteBreadcrumb } from "@/components/shared/site-breadcrumb"
import { NOINDEX } from "@/lib/seo"
import type { Metadata } from "next"

// 아직 "준비 중" 문구뿐인 빈 페이지다. 색인되면 thin content 로 잡히므로 내용이
// 채워질 때까지 뺀다 (sitemap 등록도 같이 빠져 있다).
export const metadata: Metadata = { title: "신상품", robots: NOINDEX }

// todo 1 주목할만한 추천아이템 API
// todo 2 전상 신상품 API
export default function NewPage() {
  return (
    <div>
      <main>
        {/* Product Grid */}
        <div className="container mx-auto max-w-[1360px] px-[40px] py-8">
          <SiteBreadcrumb className="mb-4" items={[{ label: "신상품" }]} />
          <h1 className="mb-6 text-2xl font-bold">신상품</h1>
          <p className="text-gray-600">신상품 페이지 준비 중입니다.</p>
        </div>
      </main>
    </div>
  )
}
