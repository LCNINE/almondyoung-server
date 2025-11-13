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
import { clientApi } from "@lib/api/client-api"
import { USER_SERVICE_BASE_URL } from "@lib/api/api.config"
import { useEffect } from "react"

// 전문 분야 한글명 매핑 (이미 한글이므로 그대로 반환)
const getSpecialtyFieldName = (specialty: string): string => {
  // 이미 한글 카테고리명이므로 그대로 반환
  return specialty || "일반"
}

// 구매 리포트 API
// 관심있게 본 상품 api
// 고객 개인화 추천 제품 API
// 자주 구매하는 재료 API
// 장바구니에서 기다리는 상품 API (이건 메두사 장바구니 fetch한후 pim을 재 fectch하면 해결될듯. 없으면 섹션없애도됨)

// 로그인한 사용자용 홈페이지 섹션들
export const HomeLoggedIn = ({ user }: { user: UserDetail | null }) => {
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
          description="#시즌제품 #스마트케어 #머신신제품"
        />
        <ProductList
          products={[]}
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
          products={[]}
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
          products={[]}
          renderCard={(product) => <BasicProductCard product={product} />}
        />
      </ProductListSection>

      <BannerCarousel slides={bannerMockData} />

      {/* 전문가를 위한 추천제품 섹션 */}
      <ProductListSection>
        <SectionHeader
          title="전문가를 위한 추천제품"
          description="전문가를 위한 추천제품을 만나보세요"
        />
        <ProductList
          products={[]}
          renderCard={(product) => <BasicProductCard product={product} />}
        />
      </ProductListSection>

      {/* 멤버십 전용 상품 섹션 */}
      <ProductListSection>
        <MembershipBanner className="mb-4" />
        <SectionHeader
          title="웰컴딜 전체 제품 100원"
          description="웰컴딜 전체 제품을 만나보세요"
        />
        <ProductList
          products={[]}
          renderCard={(product) => <BasicProductCard product={product} />}
        />
      </ProductListSection>
    </>
  )
}
