// "use client"

// import { BannerCarousel } from "@components/layout/components/banner/banner-carousel"
// import { bannerMockData } from "@components/layout/components/banner/banner-mock-data"
// import { BasicProductCard } from "@components/products/product-card"
// import ProductCatalog_section_10 from "@components/products/product-section-10"
// import ProductCatalog_section_5 from "@components/products/product-section-5"
// import ProductCatalog_section_pagination_1 from "@components/products/product-section-pagination-1"
// import { HomeProductsData } from "@lib/data/home-products"
// import { ProductCard } from "@lib/types/ui/product"
// import { UserBasicInfo as User } from "@lib/types/ui/user"
// import PurchaseReportDashboard from "app/[countryCode]/(main)/components/sections/purchase-report-section"
// import { mockOrders } from "app/data/__mocks__/user-orders-mock"
// import { useState } from "react"
// import { MembershipBanner } from "./banner/membership-banner"
// import ProductSearchedSection from "./sections/product-searched-section"
// import { SectionHeader } from "../src/domains/home/components/list/section-header"

// // 전문 분야 한글명 매핑 (이미 한글이므로 그대로 반환)
// const getSpecialtyFieldName = (specialty: string): string => {
//   // 이미 한글 카테고리명이므로 그대로 반환
//   return specialty || "일반"
// }
// // 로그인한 사용자용 홈페이지 섹션들
// export const AuthenticatedHomeSections = ({
//   user,
//   homeProductsData,
// }: {
//   user: User | null
//   homeProductsData: HomeProductsData
// }) => {
//   const [welcomeDealProducts] = useState<ProductCard[]>(
//     homeProductsData.welcomeDealProducts
//   )
//   // 사용자의 실제 주문 데이터에서 구매 횟수 계산
//   let productPurchaseCount: { [productId: string]: number } = {}

//   if (user?.id) {
//     const userIdForOrders = user.id.replace("-", "_")
//     const userOrders = mockOrders.filter(
//       (order) => order.userId === userIdForOrders
//     )

//     userOrders.forEach((order) => {
//       order.items.forEach((item) => {
//         const productId = item.productId
//         productPurchaseCount[productId] =
//           (productPurchaseCount[productId] || 0) + item.quantity
//       })
//     })
//   }

//   return (
//     <>
//       {/* 검색 결과 및 구매 리포트 섹션 */}
//       <section className="bg-muted">
//         <div className="container mx-auto max-w-[1360px] px-4 md:px-[40px]">
//           <div className="flex flex-col gap-[30px] py-[40px] lg:flex-row">
//             <div className="hidden w-full max-w-[833px] md:block">
//               <ProductSearchedSection user={user} />
//             </div>
//             <div className="w-full lg:max-w-[406px]">
//               <PurchaseReportDashboard />
//             </div>
//             <div className="block w-full max-w-[833px] md:hidden">
//               <ProductSearchedSection user={user} />
//             </div>
//           </div>
//         </div>
//       </section>
//       {/* 추천제품 섹션 */}
//       <ProductSection>
//         <ProductCatalog_section_5
//           products={[]}
//           sectionTitle={`${user?.name || "고객"}님을 위한 추천제품`}
//           sectionDescription="#시즌제품 #스마트케어 #머신신제품"
//         />
//       </ProductSection>

//       {/* 자주 구매하는 재료 다시담기 섹션 */}
//       <ProductSection>
//         <ProductCatalog_section_10
//           products={[]}
//           sectionTitle="자주 구매하는 재료 다시담기"
//           showMoreLink="/kr/my-page/order-history"
//         />
//       </ProductSection>

//       {/* 배너 캐러셀 */}
//       <ProductSection background="muted" className="py-8">
//         <BannerCarousel
//           slides={bannerMockData}
//           height="120px"
//           autoPlay={true}
//           autoPlayInterval={6000}
//           className="my-custom-class"
//         />
//       </ProductSection>

//       {/* 장바구니에서 기다리는 상품 섹션 */}
//       <ProductSection>
//         <ProductCatalog_section_5
//           products={[]}
//           sectionTitle="장바구니에서 기다리는 상품"
//           showMoreLink="/kr/cart"
//         />
//       </ProductSection>

//       {/* 전문가를 위한 추천제품 섹션 */}
//       <ProductSection>
//         <div className="flex items-center justify-between pb-4">
//           <div>
//             <span className="mb-8 text-[18px] font-bold md:text-[24px]">
//               {user?.shop?.categories && user.shop.categories.length > 0
//                 ? `${getSpecialtyFieldName(user.shop.categories[0].name)} 전문가를 위한 추천제품`
//                 : "원장님을 위한 추천제품"}
//             </span>
//             <p className="mt-1 text-sm text-gray-600 lg:text-base">
//               {user?.name || "고객"} 원장님의 전문 분야와 구매 이력을 분석한
//               맞춤 추천입니다.
//             </p>
//           </div>
//         </div>
//         {/* TODO: 데이터 연결 필요 */}
//         <div className="grid grid-cols-3 gap-4 lg:grid-cols-5 lg:gap-6"></div>
//       </ProductSection>

//       {/* 멤버십 전용 상품 섹션 */}
//       <ProductSection>
//         <MembershipBanner className="mb-4" />
//         <ProductCatalog_section_pagination_1
//           query={{
//             categoryId: "01999bee-bf43-704d-a367-2b49c14c38f2",
//             sort: "new",
//           }}
//           pageable={true}
//           sectionTitle="웰컴딜 전체 제품 100원"
//           sectionDescription="웰컴딜 전체 제품을 만나보세요"
//         />

//         {/* 스크롤 가능한 상품 리스트 - Mobile */}
//         <div className="scrollbar-hide overflow-x-auto md:hidden">
//           <div
//             className="flex gap-3"
//             style={{ width: `${welcomeDealProducts.length * 160}px` }}
//           >
//             {welcomeDealProducts.map((product) => (
//               <div key={product.id} className="w-[150px] flex-shrink-0">
//                 <BasicProductCard product={product} />
//               </div>
//             ))}
//           </div>
//         </div>

//         {/* 더보기 버튼 - Mobile */}
//         <div className="mt-4 text-center md:hidden">
//           <button className="text-sm font-medium text-gray-600">더보기</button>
//         </div>
//       </ProductSection>
//     </>
//   )
// }
