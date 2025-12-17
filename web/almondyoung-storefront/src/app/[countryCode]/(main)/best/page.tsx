import React from "react"

import { RankProductCard } from "@components/products/product-card"

import RankedKeywordList, {
  type Keyword,
} from "domains/best/components/ranked-keyword-list"
import RankedHeader from "domains/best/components/ranked-header"
import ScrollToTopButton from "./components/scroll-to-top-button"
import { getProductListService } from "@lib/services/pim/products/getProductListService"

// TODO: 백엔드에 판매량/인기도 기반 베스트 상품 API 추가 필요
// 현재 PIM API는 sortBy: "relevance" | "price" | "createdAt"만 지원
// 필요한 API:
// 1. GET /analytics/best-products?period=7d&limit=20 (판매량 기준)
// 2. GET /analytics/trending-keywords?period=7d&limit=10 (검색 키워드 랭킹)
// 3. GET /analytics/popular-brands?period=7d&limit=10 (인기 브랜드)
//
// 임시 대안: 최신 상품(createdAt:desc)을 표시하거나 빈 상태 표시

export default async function BestPage() {
  // TODO: 실제 베스트 상품 API로 교체
  // 현재는 최신 상품 20개를 가져옴 (임시)
  const bestProductsResult = await getProductListService({
    page: 1,
    limit: 20,
    sort: "createdAt:desc",
  })

  const bestProducts = bestProductsResult.items.slice(0, 5).map((product, index) => ({
    ...product,
    rank: index + 1,
  }))

  // TODO: 백엔드에 검색 키워드 랭킹 API 추가 필요
  // 현재는 빈 배열
  const keywords: Keyword[] = []

  return (
    <div className="min-h-screen">
      {/* Main Content */}
      <main className="container mx-auto max-w-[1100px] px-4 py-6 md:px-[40px]">
        {/* 베스트 상품 */}
        <section className="rounded-lg border-t border-gray-200 bg-white py-8">
          <RankedHeader title="BEST ITEMS" />

          {/* TODO: 판매량 기반 베스트 상품 API 연동 필요 */}
          {bestProducts.length > 0 ? (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {bestProducts.map((item) => (
                <RankProductCard
                  key={item.id}
                  product={item}
                  rank={item.rank}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[400px] items-center justify-center text-gray-500">
              <div className="text-center">
                <p className="text-lg font-medium">베스트 상품 준비 중입니다</p>
                <p className="mt-2 text-sm">판매량 기반 베스트 상품 API 연동이 필요합니다</p>
              </div>
            </div>
          )}
        </section>

        {/* TODO: 인기 브랜드 API 연동 필요 */}
        <section className="my-8 rounded-lg bg-white">
          <RankedHeader title="BEST BRAND" />
          {keywords.length > 0 ? (
            <RankedKeywordList keywords={keywords} />
          ) : (
            <div className="flex min-h-[300px] items-center justify-center text-gray-500">
              <div className="text-center">
                <p className="text-lg font-medium">인기 브랜드 준비 중입니다</p>
                <p className="mt-2 text-sm">브랜드별 판매량 집계 API 연동이 필요합니다</p>
              </div>
            </div>
          )}
        </section>

        {/* TODO: 인기 검색 키워드 API 연동 필요 */}
        <section className="my-8 rounded-lg bg-white">
          <RankedHeader title="BEST KEYWORD" />
          {keywords.length > 0 ? (
            <RankedKeywordList keywords={keywords} />
          ) : (
            <div className="flex min-h-[300px] items-center justify-center text-gray-500">
              <div className="text-center">
                <p className="text-lg font-medium">인기 키워드 준비 중입니다</p>
                <p className="mt-2 text-sm">검색 키워드 랭킹 API 연동이 필요합니다</p>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Scroll to Top Button */}
      <ScrollToTopButton />
    </div>
  )
}
