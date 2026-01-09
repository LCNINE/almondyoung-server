"use client"

import { BasicProductCard } from "@components/products/product-card"
import {
  homeSectionsConfig,
  loggedInSectionIds,
} from "@lib/data/home-sections-config"
import { getProductListService } from "@lib/services/pim/products/getProductListService"
import type { UserDetailDto } from "@lib/types/dto/users"
import { ProductCard } from "@lib/types/ui/product"
import MembershipBanner from "domains/home/components/banner/membership-banner"
import ProductIntrestSection from "domains/home/components/report/product-intrest-section"
import { useEffect, useState } from "react"
import ProductList from "../components/list/product-list"
import { ProductListSection } from "../components/common/product-list-section"
import SectionHeader from "../components/list/section-header"
import UserReport from "../components/report/user-report"

interface HomeLoggedInTemplateProps {
  user: UserDetailDto | null
}

/*───────────────────────────────────────────────
 * 로그인한 사용자용
 *───────────────────────────────────────────────*/
export const HomeLoggedInTemplate: React.FC<HomeLoggedInTemplateProps> = ({
  user,
}) => {
  // 섹션별 제품 상태 관리
  const [sectionProducts, setSectionProducts] = useState<
    Record<string, ProductCard[]>
  >({})
  const [isLoadingSections, setIsLoadingSections] = useState<
    Record<string, boolean>
  >({})

  // 섹션별 제품 조회 (등록일자 최근순)
  useEffect(() => {
    const loadSectionProducts = async () => {
      const loadingStates: Record<string, boolean> = {}
      const products: Record<string, ProductCard[]> = {}

      for (const sectionId of loggedInSectionIds) {
        loadingStates[sectionId] = true
        setIsLoadingSections((prev) => ({ ...prev, [sectionId]: true }))

        try {
          const config = homeSectionsConfig[sectionId]
          if (config) {
            const result = await getProductListService(config.queryParams)
            products[sectionId] = result.items
          }
        } catch (error) {
          console.error(`섹션 ${sectionId} 제품 조회 실패:`, error)
          products[sectionId] = []
        } finally {
          loadingStates[sectionId] = false
          setIsLoadingSections((prev) => ({ ...prev, [sectionId]: false }))
        }
      }

      setSectionProducts(products)
    }

    loadSectionProducts()
  }, [])

  // 섹션별 제품 가져오기
  const recommendedProducts = sectionProducts.recommended || []
  const frequentProducts = sectionProducts.frequentIngredients || []
  const cartWaitingProducts = sectionProducts.cartWaiting || []
  const expertProducts = sectionProducts.expertRecommended || []
  const membershipProducts = sectionProducts.membershipProducts || []

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
          title={`${user?.username || "고객"}님을 위한 ${homeSectionsConfig.recommended.title}`}
          description={homeSectionsConfig.recommended.description}
        />
        {isLoadingSections.recommended ? (
          <div className="py-8 text-center text-gray-500">로딩 중...</div>
        ) : (
          <ProductList
            products={recommendedProducts}
            renderCard={(product) => <BasicProductCard product={product} />}
          />
        )}
      </ProductListSection>

      {/* 자주 구매하는 재료 다시담기 섹션 */}
      <ProductListSection>
        <SectionHeader
          title={homeSectionsConfig.frequentIngredients.title}
          description={homeSectionsConfig.frequentIngredients.description}
        />
        {isLoadingSections.frequentIngredients ? (
          <div className="py-8 text-center text-gray-500">로딩 중...</div>
        ) : (
          <ProductList
            products={frequentProducts}
            renderCard={(product) => <BasicProductCard product={product} />}
          />
        )}
      </ProductListSection>

      {/* 장바구니에서 기다리는 상품 섹션 */}
      <ProductListSection>
        <SectionHeader
          title={homeSectionsConfig.cartWaiting.title}
          description={homeSectionsConfig.cartWaiting.description}
        />
        {isLoadingSections.cartWaiting ? (
          <div className="py-8 text-center text-gray-500">로딩 중...</div>
        ) : (
          <ProductList
            products={cartWaitingProducts}
            renderCard={(product) => <BasicProductCard product={product} />}
          />
        )}
      </ProductListSection>

      {/* 메인 배너 캐러셀 - TODO: 실제 배너 데이터 API 연동 필요 */}
      {/* <div className="w-full lg:py-8">
        <div className="container mx-auto max-w-[1360px] px-4 md:px-[40px]">
          <BannerCarousel
            slides={[]}
            height="120px"
            autoPlay={true}
            autoPlayInterval={6000}
            className="lg:overflow-hidden lg:rounded-2xl"
          />
        </div>
      </div> */}

      {/* 전문가를 위한 추천제품 섹션 */}
      <ProductListSection>
        <SectionHeader
          title={homeSectionsConfig.expertRecommended.title}
          description={homeSectionsConfig.expertRecommended.description}
        />
        {isLoadingSections.expertRecommended ? (
          <div className="py-8 text-center text-gray-500">로딩 중...</div>
        ) : (
          <ProductList
            products={expertProducts}
            renderCard={(product) => <BasicProductCard product={product} />}
          />
        )}
      </ProductListSection>

      {/* 멤버십 전용 상품 섹션 */}
      <ProductListSection>
        <MembershipBanner className="mb-4" />
        <SectionHeader
          title={homeSectionsConfig.membershipProducts.title}
          description={homeSectionsConfig.membershipProducts.description}
        />
        {isLoadingSections.membershipProducts ? (
          <div className="py-8 text-center text-gray-500">로딩 중...</div>
        ) : (
          <ProductList
            products={membershipProducts}
            renderCard={(product) => <BasicProductCard product={product} />}
          />
        )}
      </ProductListSection>
    </>
  )
}
