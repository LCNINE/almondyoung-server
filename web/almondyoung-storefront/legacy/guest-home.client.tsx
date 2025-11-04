// "use client"

// import React, { useMemo, useState } from "react"
// import { BannerCarousel } from "@components/layout/components/banner/banner-carousel"
// import {
//   BasicProductCard,
//   RankProductCard,
//   DiscountProductCard,
// } from "@components/products/product-card"
// import { bannerMockData } from "@components/layout/components/banner/banner-mock-data"
// import { MembershipBanner } from "domains/home/components/banner/membership-banner"
// import { PimCategory } from "@lib/types/dto/pim"
// import { ProductCard } from "@lib/types/ui/product"
// import { CategoryProductsSection } from "./sections/category-products-section"
// import { HomeProductsData } from "@lib/data/home-products"

// import { SectionHeader } from "../src/domains/home/components/list/section-header"
// import { ProductList } from "../src/domains/home/components/list/product-list"

// import ProductCatalog_section_5 from "@components/products/product-section-5"

// // 더미 JSON 데이터 import (서버 데이터 구조 그대로)
// import hairProducts from "@lib/data/dummy/get-hair-list.json"
// import nailProducts from "@lib/data/dummy/get-nail-list.json"
// import semiProducts from "@lib/data/dummy/get-semi-permanent-list.json"
// import waxingProducts from "@lib/data/dummy/get-waxing-list.json"
// import tattooProducts from "@lib/data/dummy/get-tattoo-list.json"
// import skinProducts from "@lib/data/dummy/get-skin-list.json"
// import CategoryFilter from "../src/domains/home/components/list/category-filter"
// import { ProductListSix } from "domains/home/components/list/product-list-six"
// import { ProductListSection } from "domains/home/components/list/product-list-section"

// // 서버 데이터를 ProductCard 타입으로 변환하는 헬퍼 함수
// function convertToProductCard(serverData: any): ProductCard {
//   const basePrice = serverData.basePrice || 0
//   const memberPrice = serverData.membershipPrice || null
//   const discountRate =
//     memberPrice && basePrice > memberPrice
//       ? Math.round(((basePrice - memberPrice) / basePrice) * 100)
//       : undefined

//   return {
//     id: serverData.id,
//     name: serverData.name,
//     thumbnail: serverData.thumbnail || "", // 필수 필드
//     image: serverData.thumbnail || "", // 옵션 필드 (호환성)
//     price: {
//       original: basePrice,
//       member: memberPrice,
//       discountRate,
//       isMembership: serverData.isMembershipOnly || false,
//     },
//     isMembershipOnly: serverData.isMembershipOnly || false,
//     isSoldOut: serverData.status !== "active", // status가 active가 아니면 품절
//     brand: "", // 서버 데이터에 없음 (옵션)
//     tags: [], // 서버 데이터에 없음 (옵션)
//   }
// }

// // 비로그인 사용자용 홈페이지 섹션들
// export const GuestHomeSections: React.FC<{
//   categories: PimCategory[]
//   homeProductsData: HomeProductsData
// }> = ({ categories, homeProductsData }) => {
//   // 더미 JSON 데이터를 ProductCard 타입으로 변환 (useMemo로 최적화)
//   const allProducts = useMemo(
//     () => ({
//       hair: hairProducts.data.map(convertToProductCard),
//       nail: nailProducts.data.map(convertToProductCard),
//       semi: semiProducts.data.map(convertToProductCard),
//       waxing: waxingProducts.data.map(convertToProductCard),
//       tattoo: tattooProducts.data.map(convertToProductCard),
//       skin: skinProducts.data.map(convertToProductCard),
//     }),
//     []
//   )

//   // 각 섹션별 상품 할당 (제목은 유지하되 상품은 더미 데이터 사용)
//   const hotKeywordProducts: ProductCard[] = [] // 비어있음
//   const newProducts = allProducts.hair.slice(0, 10) // 신상품: 헤어 상품 사용
//   const welcomeDealProducts = allProducts.nail.slice(0, 10) // 웰컴딜: 네일 상품 사용
//   const recommendedProducts = allProducts.semi.slice(0, 10) // 재구매 많은: 반영구 상품
//   const fitTop10Products = allProducts.waxing.slice(0, 10) // 인기 급상승: 왁싱 상품

//   // 카테고리별 상품 (타임세일용)
//   const allCategoryProducts = useMemo(() => {
//     const result: Record<string, ProductCard[]> = {
//       all: [...allProducts.hair.slice(0, 5), ...allProducts.nail.slice(0, 5)],
//     }

//     // 각 카테고리에 해당하는 상품 매핑
//     categories.slice(0, 7).forEach((category, index) => {
//       const productsList = [
//         allProducts.hair,
//         allProducts.nail,
//         allProducts.semi,
//         allProducts.waxing,
//         allProducts.tattoo,
//         allProducts.skin,
//       ]
//       result[category.id] = productsList[index % productsList.length].slice(
//         0,
//         10
//       )
//     })

//     return result
//   }, [categories, allProducts])

//   const initialCategoryProducts = allCategoryProducts.all || []

//   // 카테고리 탭 생성
//   const categoryTabs = categories.slice(0, 7).map((category) => ({
//     id: category.id,
//     name: category.name,
//   }))

//   const timeSaleCategories = [{ id: "all", name: "전체" }, ...categoryTabs]

//   // 타임세일 카테고리 상태 관리
//   const [selectedTimeSaleCategory, setSelectedTimeSaleCategory] =
//     useState("all")
//   const timeSaleProducts = allCategoryProducts[selectedTimeSaleCategory] || []

//   return (
//     <div className="w-full">
//       <ProductListSection>
//         <SectionHeader
//           title="카테고리별 제품"
//           description="카테고리별 제품을 만나보세요"
//         />
//         <CategoryFilter />
//         <div className="mt-6">
//           <ProductListSix
//             products={fitTop10Products}
//             renderCard={(product, index) => (
//               <RankProductCard product={product} rank={index + 1} />
//             )}
//           />
//         </div>
//       </ProductListSection>
//       {/* 핫 키워드 섹션 - 데이터가 있을 때만 표시 */}
//       {hotKeywordProducts.length > 0 && (
//         <section className="border-gray-20 w-full border-t py-8 lg:py-12">
//           <div className="mx-auto w-full max-w-[1360px] px-4 md:px-[40px]">
//             <ProductCatalog_section_5
//               products={hotKeywordProducts}
//               sectionTitle="핫 키워드 제품"
//               sectionDescription="#시즌제품 #스마트케어 #머신신제품"
//             />
//           </div>
//         </section>
//       )}

//       {/* 신상품 섹션 */}
//       <ProductListSection>
//         <SectionHeader title="신상품" description="신상품을 만나보세요" />
//         <ProductList
//           products={newProducts.slice(0, 10)}
//           renderCard={(product) => <BasicProductCard product={product} />}
//         />
//       </ProductListSection>

//       {/* 웰컴딜 섹션 */}
//       <ProductListSection>
//         <MembershipBanner className="mb-4" />
//         <SectionHeader
//           title="웰컴딜 전체 제품 100원"
//           description="웰컴딜 전체 제품을 만나보세요"
//         />
//         <ProductList
//           products={welcomeDealProducts.slice(0, 10)}
//           renderCard={(product) => <BasicProductCard product={product} />}
//         />
//       </ProductListSection>
//       {/* 타임세일 섹션 */}
//       <ProductListSection>
//         <SectionHeader
//           title="타임세일"
//           description="타임세일 전체 제품을 만나보세요"
//         />
//         <CategoryFilter />
//         <div className="mt-6">
//           <ProductList
//             products={timeSaleProducts}
//             renderCard={(product) => (
//               <DiscountProductCard product={product} minWidth={100} />
//             )}
//           />
//         </div>
//       </ProductListSection>
//       {/* 디지털 템플릿 섹션 */}
//       {allProducts.tattoo.length > 0 && (
//         <ProductListSection>
//           <SectionHeader
//             title="간편편집, 뷰티샵 디지털 템플릿"
//             description="캔바로 쉽게 편집할 수 있는 전문가용 템플릿"
//           />
//           <ProductList
//             products={allProducts.tattoo.slice(0, 10)}
//             renderCard={(product) => <BasicProductCard product={product} />}
//           />
//         </ProductListSection>
//       )}
//       {/* 메인 배너 캐러셀 */}
//       <div className="w-full lg:py-8">
//         <div className="container mx-auto max-w-[1360px] px-4 md:px-[40px]">
//           <BannerCarousel
//             slides={bannerMockData}
//             height="120px"
//             autoPlay={true}
//             autoPlayInterval={6000}
//             className="lg:overflow-hidden lg:rounded-2xl"
//           />
//         </div>
//       </div>
//       {/* 인기 급상승 제품 섹션 */}
//       {fitTop10Products.length > 0 && (
//         <ProductListSection className="bg-gradient-to-b from-purple-50 to-white">
//           <SectionHeader
//             title="인기 급상승 제품"
//             description="이번 주 가장 인기 있는 제품들을 만나보세요"
//           />
//           <ProductList
//             products={fitTop10Products}
//             renderCard={(product, index) => (
//               <RankProductCard product={product} rank={index + 1} />
//             )}
//           />
//         </ProductListSection>
//       )}

//       {/* 재구매 많은 제품 섹션 */}
//       {recommendedProducts.length > 0 && (
//         <ProductListSection>
//           <SectionHeader
//             title="재구매 많은 제품"
//             description="한 번 사면 반드시 다시 구매하는 제품들을 만나보세요"
//           />
//           <ProductList
//             products={fitTop10Products}
//             renderCard={(product, index) => (
//               <BasicProductCard product={product} />
//             )}
//           />
//         </ProductListSection>
//       )}
//       {/* SEO를 위한 추가 컨텐츠 (숨김 처리 가능) */}
//       <div className="sr-only">
//         <h1>아몬드영 - 최저가 미용재료 MRO 쇼핑몰</h1>
//         <p>미용 전문 재료를 최저가로 빠르게 구매할 수 있는 아몬드영입니다.</p>
//         <p>
//           속눈썹, 네일, 왁싱, 반영구, 헤어, 타투, 피부미용 전문 재료를 한 곳에서
//           만나보세요.
//         </p>
//       </div>
//     </div>
//   )
// }

// // 스크롤바 숨기기 스타일은 useEffect에서 처리됨
