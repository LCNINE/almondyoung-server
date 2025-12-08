"use client"

import React, { useMemo, useState, useEffect } from "react"
import { BannerCarousel } from "@components/layout/components/banner/banner-carousel"
import {
  BasicProductCard,
  RankProductCard,
  DiscountProductCard,
} from "@components/products/product-card"
import { MembershipBanner } from "domains/home/components/banner/membership-banner"
import { ProductCard } from "@lib/types/ui/product"
import ProductListSix from "domains/home/components/list/product-list-six"
import SectionHeader from "./components/list/section-header"
import ProductList from "./components/list/product-list"
import { ProductListSection } from "./components/list/product-list-section"
import CategoryBadgeTabs from "@components/category-badge-tabs"
import type { CategoryTreeNode } from "@lib/api/pim/pim-types"
import { getProductsByCategoryService } from "@lib/services/pim/products/getProductListService"
import { getProductListService } from "@lib/services/pim/products/getProductListService"
import {
  homeSectionsConfig,
  logoutSectionIds,
} from "@lib/data/home-sections-config"

// 비로그인 사용자용 홈페이지 섹션들
export const HomeLogout: React.FC<{
  categories: CategoryTreeNode[]
  initialCategoryId: string | null
  initialCategoryProducts: ProductCard[]
}> = ({ categories, initialCategoryId, initialCategoryProducts }) => {
  // 카테고리별 제품 섹션 상태 관리
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>(
    initialCategoryId || ""
  )
  const [categoryProducts, setCategoryProducts] = useState<ProductCard[]>(
    initialCategoryProducts
  )
  const [isLoadingCategoryProducts, setIsLoadingCategoryProducts] =
    useState(false)

  // 타임세일 카테고리 상태 관리
  const [selectedTimeSaleCategory, setSelectedTimeSaleCategory] =
    useState<string>(initialCategoryId || "all")
  const [timeSaleProducts, setTimeSaleProducts] = useState<ProductCard[]>([])
  const [isLoadingTimeSaleProducts, setIsLoadingTimeSaleProducts] =
    useState(false)

  // 섹션별 제품 상태 관리
  const [sectionProducts, setSectionProducts] = useState<
    Record<string, ProductCard[]>
  >({})
  const [isLoadingSections, setIsLoadingSections] = useState<Record<string, boolean>>({})

  // 카테고리 선택 시 제품 조회
  useEffect(() => {
    if (!selectedCategoryId) return

    setIsLoadingCategoryProducts(true)
    getProductsByCategoryService(selectedCategoryId, {
      page: 1,
      limit: 10,
    })
      .then((result) => {
        setCategoryProducts(result.items)
      })
      .catch((error) => {
        console.error("카테고리별 제품 조회 실패:", error)
        setCategoryProducts([])
      })
      .finally(() => {
        setIsLoadingCategoryProducts(false)
      })
  }, [selectedCategoryId])

  // 타임세일 카테고리 선택 시 제품 조회
  useEffect(() => {
    if (!selectedTimeSaleCategory || selectedTimeSaleCategory === "all") {
      // 전체 조회
      setIsLoadingTimeSaleProducts(true)
      getProductListService({
        page: 1,
        limit: 20,
        sort: "createdAt:desc",
      })
        .then((result) => {
          setTimeSaleProducts(result.items)
        })
        .catch((error) => {
          console.error("타임세일 제품 조회 실패:", error)
          setTimeSaleProducts([])
        })
        .finally(() => {
          setIsLoadingTimeSaleProducts(false)
        })
    } else {
      setIsLoadingTimeSaleProducts(true)
      getProductsByCategoryService(selectedTimeSaleCategory, {
        page: 1,
        limit: 20,
      })
        .then((result) => {
          setTimeSaleProducts(result.items)
        })
        .catch((error) => {
          console.error("타임세일 카테고리별 제품 조회 실패:", error)
          setTimeSaleProducts([])
        })
        .finally(() => {
          setIsLoadingTimeSaleProducts(false)
        })
    }
  }, [selectedTimeSaleCategory])

  // 섹션별 제품 조회 (등록일자 최근순)
  useEffect(() => {
    const loadSectionProducts = async () => {
      const loadingStates: Record<string, boolean> = {}
      const products: Record<string, ProductCard[]> = {}

      for (const sectionId of logoutSectionIds) {
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


  return (
    <div className="w-full">
      {/* 카테고리별 제품 섹션 */}
      <ProductListSection>
        <SectionHeader
          title="카테고리별 제품"
          description="카테고리별 제품을 만나보세요"
        />
        <CategoryBadgeTabs
          categories={categories}
          initialCategoryId='first'
          onCategorySelect={setSelectedCategoryId}
        />
        <div className="mt-6">
          {isLoadingCategoryProducts ? (
            <div className="py-8 text-center text-gray-500">로딩 중...</div>
          ) : categoryProducts.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <p>해당 카테고리에 등록된 상품이 없습니다.</p>
            </div>
          ) : (
            <ProductListSix
              products={categoryProducts}
              renderCard={(product, index) => (
                <RankProductCard product={product} rank={index + 1} />
              )}
            />
          )}
        </div>
      </ProductListSection>

      {/* 신상품 섹션 */}
      <ProductListSection>
        <SectionHeader
          title={homeSectionsConfig.newProducts.title}
          description={homeSectionsConfig.newProducts.description}
        />
        {isLoadingSections.newProducts ? (
          <div className="py-8 text-center text-gray-500">로딩 중...</div>
        ) : (
          <ProductList
            products={sectionProducts.newProducts || []}
            renderCard={(product) => <BasicProductCard product={product} />}
          />
        )}
      </ProductListSection>

      {/* 웰컴딜 섹션 */}
      <ProductListSection>
        <MembershipBanner className="mb-4" />
        <SectionHeader
          title={homeSectionsConfig.welcomeDeal.title}
          description={homeSectionsConfig.welcomeDeal.description}
        />
        {isLoadingSections.welcomeDeal ? (
          <div className="py-8 text-center text-gray-500">로딩 중...</div>
        ) : (
          <ProductList
            products={sectionProducts.welcomeDeal || []}
            renderCard={(product) => <BasicProductCard product={product} />}
          />
        )}
      </ProductListSection>

      {/* 타임세일 섹션 */}
      <ProductListSection>
        <SectionHeader
          title="타임세일"
          description="타임세일 전체 제품을 만나보세요"
        />
        <CategoryBadgeTabs
          categories={categories}
          initialCategoryId='first'
          onCategorySelect={setSelectedTimeSaleCategory}
        />
        <div className="mt-6">
          {isLoadingTimeSaleProducts ? (
            <div className="py-8 text-center text-gray-500">로딩 중...</div>
          ) : timeSaleProducts.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <p>해당 카테고리에 등록된 상품이 없습니다.</p>
            </div>
          ) : (
            <ProductList
              products={timeSaleProducts}
              renderCard={(product) => (
                <DiscountProductCard product={product} minWidth={100} />
              )}
            />
          )}
        </div>
      </ProductListSection>

      {/* 디지털 템플릿 섹션 */}
      {(sectionProducts.digitalTemplate?.length || 0) > 0 && (
        <ProductListSection>
          <SectionHeader
            title={homeSectionsConfig.digitalTemplate.title}
            description={homeSectionsConfig.digitalTemplate.description}
          />
          {isLoadingSections.digitalTemplate ? (
            <div className="py-8 text-center text-gray-500">로딩 중...</div>
          ) : (
            <ProductList
              products={sectionProducts.digitalTemplate || []}
              renderCard={(product) => <BasicProductCard product={product} />}
            />
          )}
        </ProductListSection>
      )}

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

      {/* 인기 급상승 제품 섹션 */}
      <ProductListSection className="bg-linear-to-b from-purple-50 to-white">
        <SectionHeader
          title={homeSectionsConfig.hotRising.title}
          description={homeSectionsConfig.hotRising.description}
        />
        {isLoadingSections.hotRising ? (
          <div className="py-8 text-center text-gray-500">로딩 중...</div>
        ) : (
          <ProductList
            products={sectionProducts.hotRising || []}
            renderCard={(product, index) => (
              <RankProductCard product={product} rank={index + 1} />
            )}
          />
        )}
      </ProductListSection>

      {/* 재구매 많은 제품 섹션 */}
      <ProductListSection>
        <SectionHeader
          title={homeSectionsConfig.frequentRebuy.title}
          description={homeSectionsConfig.frequentRebuy.description}
        />
        {isLoadingSections.frequentRebuy ? (
          <div className="py-8 text-center text-gray-500">로딩 중...</div>
        ) : (
          <ProductList
            products={sectionProducts.frequentRebuy || []}
            renderCard={(product, index) => (
              <BasicProductCard product={product} />
            )}
          />
        )}
      </ProductListSection>

      {/* SEO를 위한 추가 컨텐츠 (숨김 처리 가능) */}
      <div className="sr-only">
        <h1>아몬드영 - 최저가 미용재료 MRO 쇼핑몰</h1>
        <p>미용 전문 재료를 최저가로 빠르게 구매할 수 있는 아몬드영입니다.</p>
        <p>
          속눈썹, 네일, 왁싱, 반영구, 헤어, 타투, 피부미용 전문 재료를 한 곳에서
          만나보세요.
        </p>
      </div>
    </div>
  )
}

// 스크롤바 숨기기 스타일은 useEffect에서 처리됨
