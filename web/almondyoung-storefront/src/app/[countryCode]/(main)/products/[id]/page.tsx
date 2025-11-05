import { Suspense } from "react"
// import ProductDetailClient from "domains/products/product-details/productDetail.client" // 원본 보존
import { ProductDetailPageNew } from "domains/products/product-details" // 새 버전
import { ProductDetail } from "@lib/types/ui/product"
import productDetailData from "@lib/data/dummy/get-product-details.json"
// 더미 JSON 데이터 import (서버 데이터 구조 그대로)
import { WithHeaderLayout } from "@components/layout/with-header-layout"
import { ProductDetailReview } from "./components"
import { ReviewCardList } from "domains/reviews/summary/review-card-list"
import ProductDetailClient from "domains/products/product-details/productDetail.client"

/**
 * 서버 데이터를 ProductDetail 타입으로 변환
 *
 * 책임:
 * 📡 서버: 가격, 상태 등 비즈니스 데이터 제공
 * 💻 프론트: 최소한의 UI 데이터 가공 (이미지 추출, 경로 변환)
 */
function convertToProductDetail(serverData: any): ProductDetail {
  // descriptionHtml에서 이미지 추출
  const extractImages = (html: string | null): string[] => {
    if (!html) return []
    const regex = /<img[^>]+src=["']([^"']+)["']/gi
    const matches: string[] = []
    let match
    while ((match = regex.exec(html)) !== null) {
      let imageUrl = match[1]
      // 상대 경로를 절대 경로로 변환
      if (imageUrl.startsWith("/")) {
        imageUrl = `https://almondyoung.com${imageUrl}`
      }
      matches.push(imageUrl)
    }
    return matches
  }

  const thumbnails = serverData.thumbnail ? [serverData.thumbnail] : []
  const detailImages = extractImages(serverData.descriptionHtml)

  return {
    // ===== 서버에서 제공하는 원본 데이터 =====
    id: serverData.id,
    name: serverData.name,
    brand: serverData.brand || "",
    thumbnail: serverData.thumbnail || "",
    description: serverData.description,
    descriptionHtml: serverData.descriptionHtml,

    // ===== 가격 정보 (서버 제공) =====
    basePrice: serverData.basePrice ?? 30000, // 고정값
    membershipPrice: serverData.membershipPrice ?? 24000, // 고정값 (20% 할인)
    isMembershipOnly: serverData.isMembershipOnly || false,

    // ===== 상태 정보 (서버 제공) =====
    status: serverData.status || "active",

    // ===== UI용 추출 데이터 =====
    thumbnails,
    detailImages,
    tags: serverData.tags || [],

    // ===== 고정값 (실제 API 연동 시 서버에서 제공) =====
    options: [], // 옵션은 추후 구현
    rating: 4.8,
    reviewCount: 2847,
    qnaCount: 124,

    // 멤버십 등급별 가격 (고정값)
    memberPrices: [
      { range: "1~4", rate: 20, price: 24000 },
      { range: "5~9", rate: 25, price: 22500 },
      { range: "10~∞", rate: 30, price: 21000 },
    ],
    originalPrice: 30000, // 호환성

    // 배송 정보 (고정값)
    shipping: {
      type: "domestic",
      method: "택배",
      cost: "2,500원",
      averageRestockDays: 5,
      shipmentInfo: "(50,000원 이상 구매 시 무료)",
    },

    // 상품 정보 (고정값)
    productInfo: {
      productNumber: "P" + serverData.id.slice(0, 8).toUpperCase(),
      weight: "150g",
      dimensions: "50mm × 150mm",
      origin: "대한민국",
      capacity: "150ml",
      expirationDate: "제조일로부터 3년",
      manufacturer: serverData.brand || "제이시스",
      brand: serverData.brand || "티나스타일",
      material: "정제수, 글리세린, 카프릴릴글리콜, 디프로필렌글리콜 등",
      usage: "적당량을 손에 덜어 모발에 골고루 발라줍니다.",
    },

    seo: {
      title: serverData.seoTitle || serverData.name,
      description: serverData.seoDescription || serverData.description,
      keywords: serverData.seoKeywords || "",
    },
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string; countryCode: string }>
}) {
  const { id, countryCode } = await params
  let product: ProductDetail | null = null
  let error: string | null = null
  const user = null

  try {
    // 더미 JSON 데이터를 UI 타입으로 변환 (모든 ID에 대해 같은 데이터 반환)
    product = convertToProductDetail(productDetailData)
  } catch (err) {
    console.error("상품 상세 정보 로드 실패:", err)
    error =
      err instanceof Error ? err.message : "상품 정보를 불러올 수 없습니다."
  }

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: true,
      }}
    >
      <div className="md:bg-muted/50 min-h-screen bg-white">
        <Suspense fallback={<div className="p-8">로딩 중…</div>}>
          <ProductDetailPageNew
            params={Promise.resolve({ id, countryCode })}
            product={product}
            error={error}
            user={user}
          />
        </Suspense>
      </div>
    </WithHeaderLayout>
  )
}
