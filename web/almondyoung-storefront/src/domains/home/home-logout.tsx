"use client"

import React, { useMemo, useState } from "react"
import { BannerCarousel } from "@components/layout/components/banner/banner-carousel"
import {
  BasicProductCard,
  RankProductCard,
  DiscountProductCard,
} from "@components/products/product-card"
import { bannerMockData } from "@components/layout/components/banner/banner-mock-data"
import { MembershipBanner } from "domains/home/components/banner/membership-banner"
import { PimCategory } from "@lib/types/dto/pim"
import { ProductCard } from "@lib/types/ui/product"
// import { CategoryProductsSection } from "app/[countryCode]/(main)/components/sections/category-products-section"

// 더미 JSON 데이터 import (서버 데이터 구조 그대로)
import hairProducts from "@lib/data/dummy/get-hair-list.json"
import nailProducts from "@lib/data/dummy/get-nail-list.json"
import semiProducts from "@lib/data/dummy/get-semi-permanent-list.json"
import waxingProducts from "@lib/data/dummy/get-waxing-list.json"
import tattooProducts from "@lib/data/dummy/get-tattoo-list.json"
import skinProducts from "@lib/data/dummy/get-skin-list.json"

import ProductListSix from "domains/home/components/list/product-list-six"
import SectionHeader from "./components/list/section-header"
import ProductList from "./components/list/product-list"
import { ProductListSection } from "./components/list/product-list-section"
import CategoryBadgeList from "@components/category-badge-tabs"

// 서버 데이터를 그대로 사용 (변환 불필요)

// 비로그인 사용자용 홈페이지 섹션들
export const HomeLogout: React.FC<{
  categories: PimCategory[]
}> = ({ categories }) => {
  // 타임세일 카테고리 상태 관리
  const [selectedTimeSaleCategory, setSelectedTimeSaleCategory] =
    useState("all")
  // 더미 JSON 데이터를 그대로 사용 (서버 구조 = UI 구조)
  const allProducts = useMemo(
    () => ({
      hair: hairProducts.data as ProductCard[],
      nail: nailProducts.data as ProductCard[],
      semi: semiProducts.data as ProductCard[],
      waxing: waxingProducts.data as ProductCard[],
      tattoo: tattooProducts.data as ProductCard[],
      skin: skinProducts.data as ProductCard[],
    }),
    []
  )

  // 각 섹션별 상품 할당 (제목은 유지하되 상품은 더미 데이터 사용)
  const hotKeywordProducts: ProductCard[] = [] // 비어있음
  const newProducts = allProducts.hair.slice(0, 10) // 신상품: 헤어 상품 사용
  const welcomeDealProducts = allProducts.nail.slice(0, 10) // 웰컴딜: 네일 상품 사용
  const recommendedProducts = allProducts.semi.slice(0, 10) // 재구매 많은: 반영구 상품
  const fitTop10Products = allProducts.waxing.slice(0, 10) // 인기 급상승: 왁싱 상품

  // 카테고리별 상품 (타임세일용)
  const allCategoryProducts = useMemo(() => {
    const result: Record<string, ProductCard[]> = {
      all: [...allProducts.hair.slice(0, 5), ...allProducts.nail.slice(0, 5)],
    }

    // 각 카테고리에 해당하는 상품 매핑
    categories.slice(0, 7).forEach((category, index) => {
      const productsList = [
        allProducts.hair,
        allProducts.nail,
        allProducts.semi,
        allProducts.waxing,
        allProducts.tattoo,
        allProducts.skin,
      ]
      result[category.id] = productsList[index % productsList.length].slice(
        0,
        10
      )
    })

    return result
  }, [categories, allProducts])

  const timeSaleProducts = allCategoryProducts[selectedTimeSaleCategory] || []

  return (
    <div className="w-full">
      <ProductListSection>
        <SectionHeader
          title="카테고리별 제품"
          description="카테고리별 제품을 만나보세요"
        />
        <CategoryBadgeList />
        <div className="mt-6">
          <ProductListSix
            products={fitTop10Products}
            renderCard={(product, index) => (
              <RankProductCard product={product} rank={index + 1} />
            )}
          />
        </div>
      </ProductListSection>
      <ProductListSection>
        <SectionHeader
          title="인기 제품"
          description="인기 제품을 만나보세요 키워드 제품"
        />
        <div className="mt-6">
          <ProductListSix
            products={fitTop10Products}
            renderCard={(product, index) => (
              <RankProductCard product={product} rank={index + 1} />
            )}
          />
        </div>
      </ProductListSection>

      {/* 신상품 섹션 */}
      <ProductListSection>
        <SectionHeader title="신상품" description="신상품을 만나보세요" />
        <ProductList
          products={newProducts.slice(0, 10)}
          renderCard={(product) => <BasicProductCard product={product} />}
        />
      </ProductListSection>

      {/* 웰컴딜 섹션 */}
      <ProductListSection>
        <MembershipBanner className="mb-4" />
        <SectionHeader
          title="웰컴딜 전체 제품 100원"
          description="웰컴딜 전체 제품을 만나보세요"
        />
        <ProductList
          products={welcomeDealProducts.slice(0, 10)}
          renderCard={(product) => <BasicProductCard product={product} />}
        />
      </ProductListSection>
      {/* 타임세일 섹션 */}
      <ProductListSection>
        <SectionHeader
          title="타임세일"
          description="타임세일 전체 제품을 만나보세요"
        />
        <CategoryBadgeList />
        <div className="mt-6">
          <ProductList
            products={timeSaleProducts}
            renderCard={(product) => (
              <DiscountProductCard product={product} minWidth={100} />
            )}
          />
        </div>
      </ProductListSection>
      {/* 디지털 템플릿 섹션 */}
      {allProducts.tattoo.length > 0 && (
        <ProductListSection>
          <SectionHeader
            title="간편편집, 뷰티샵 디지털 템플릿"
            description="캔바로 쉽게 편집할 수 있는 전문가용 템플릿"
          />
          <ProductList
            products={allProducts.tattoo.slice(0, 10)}
            renderCard={(product) => <BasicProductCard product={product} />}
          />
        </ProductListSection>
      )}
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

      <ProductListSection className="bg-gradient-to-b from-purple-50 to-white">
        <SectionHeader
          title="인기 급상승 제품"
          description="이번 주 가장 인기 있는 제품들을 만나보세요"
        />
        <ProductList
          products={fitTop10Products}
          renderCard={(product, index) => (
            <RankProductCard product={product} rank={index + 1} />
          )}
        />
      </ProductListSection>

      <ProductListSection>
        <SectionHeader
          title="재구매 많은 제품"
          description="한 번 사면 반드시 다시 구매하는 제품들을 만나보세요"
        />
        <ProductList
          products={fitTop10Products}
          renderCard={(product, index) => (
            <BasicProductCard product={product} />
          )}
        />
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
