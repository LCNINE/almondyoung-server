"use client"

import { BannerCarousel } from "@components/layout/components/banner/banner-carousel"
import { bannerMockData } from "@components/layout/components/banner/banner-mock-data"
import { BasicProductCard } from "@components/products/product-card"
import { UserDetail } from "domains/auth/types"
import MembershipBanner from "domains/home/components/banner/membership-banner"
import ProductIntrestSection from "domains/home/components/report/product-intrest-section"
import PurchaseReportDashboard from "domains/home/components/report/purchase-report-section"
import ProductList from "./components/list/product-list"
import { ProductListSection } from "./components/list/product-list-section"
import SectionHeader from "./components/list/section-header"
import UserReport from "./components/report/user-report"
import { ProductCard } from "@lib/types/ui/product"

// 더미 JSON 데이터 import (개인화된 사용자는 주로 구매하는 카테고리 데이터 사용)
import hairProducts from "@lib/data/dummy/get-hair-list.json"

// 로그인한 사용자용 홈페이지 섹션들
export const HomeLoggedIn = ({ user }: { user: UserDetail | null }) => {
  // 개인화 데이터 - 실제로는 사용자의 주요 구매 카테고리를 기반으로 함
  const personalizedProducts = hairProducts.data as ProductCard[]

  // 각 섹션별 상품 할당 (데이터 재사용으로 모든 섹션에 표시)
  const recommendedProducts = personalizedProducts.slice(0, 10) // 추천제품
  const frequentProducts = personalizedProducts.slice(2, 12) // 자주 구매하는 재료
  const cartWaitingProducts = personalizedProducts.slice(4, 14) // 장바구니 대기 상품
  const expertProducts = personalizedProducts.slice(1, 11) // 전문가용 추천
  const membershipProducts = personalizedProducts.slice(3, 13) // 멤버십 전용

  return (
    <>
      {/* 검색 결과 및 구매 리포트 섹션 */}
      <section>
        <div className="container mx-auto max-w-[1360px] px-4 md:px-[40px]">
          <div className="flex flex-col gap-[30px] py-[40px] lg:flex-row">
            <div className="hidden w-full max-w-[833px] md:block">
              <ProductIntrestSection />
            </div>
            <div className="w-full lg:max-w-[406px]">
              <UserReport />
            </div>
            <div className="block w-full max-w-[833px] md:hidden">
              <ProductIntrestSection />
            </div>
          </div>
        </div>
      </section>

      {/* 추천제품 섹션 */}
      <ProductListSection>
        <SectionHeader
          title={`${user?.username || "고객"}님을 위한 추천제품`}
          description="#시즌제품 #스마트케어 #머신 신제품"
        />
        <ProductList
          products={recommendedProducts}
          renderCard={(product) => <BasicProductCard product={product} />}
        />
      </ProductListSection>

      {/* 자주 구매하는 재료 다시담기 섹션 */}
      <ProductListSection>
        <SectionHeader
          title="자주 구매하는 재료 다시담기"
          description="자주 구매하는 재료를 다시담기"
        />
        <ProductList
          products={frequentProducts}
          renderCard={(product) => <BasicProductCard product={product} />}
        />
      </ProductListSection>

      {/* 장바구니에서 기다리는 상품 섹션 */}
      <ProductListSection>
        <SectionHeader
          title="장바구니에서 기다리는 상품"
          description="장바구니에서 기다리는 상품을 만나보세요"
        />
        <ProductList
          products={cartWaitingProducts}
          renderCard={(product) => <BasicProductCard product={product} />}
        />
      </ProductListSection>

      {/* 메인 배너 캐러셀 */}
      <div className="w-full lg:py-8">
        <div className="container mx-auto max-w-[1360px] px-4 md:px-[40px]">
          <BannerCarousel
            slides={bannerMockData}
            height="120px"
            autoPlay={true}
            autoPlayInterval={6000}
            className="lg:overflow-hidden lg:rounded-2xl"
          />
        </div>
      </div>

      {/* 전문가를 위한 추천제품 섹션 */}
      <ProductListSection>
        <SectionHeader
          title="전문가를 위한 추천제품"
          description="전문가를 위한 추천제품을 만나보세요"
        />
        <ProductList
          products={expertProducts}
          renderCard={(product) => <BasicProductCard product={product} />}
        />
      </ProductListSection>

      {/* 멤버십 전용 상품 섹션 */}
      <ProductListSection>
        <MembershipBanner className="mb-4" />
        <SectionHeader
          title="웰컴드 전체 제품 100원"
          description="웰컴드 전체 제품을 만나보세요"
        />
        <ProductList
          products={membershipProducts}
          renderCard={(product) => <BasicProductCard product={product} />}
        />
      </ProductListSection>
    </>
  )
}
