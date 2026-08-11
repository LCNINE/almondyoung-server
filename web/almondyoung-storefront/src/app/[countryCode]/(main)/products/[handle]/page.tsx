import { ProductTemplate } from "@/domains/products/product-details/templates"
import { ViewItemTracker } from "@/domains/products/product-details/components/view-item-tracker"
import { toGaCurrency } from "@/lib/analytics/gtag"
import { getProductPrice } from "@/lib/utils/get-product-price"
import { redirectToLogin } from "@/lib/api/medusa/auth-utils"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getProductDetailByMasterId } from "@/lib/api/pim/products"
import { getQnaSummary } from "@/lib/api/ugc"
import { getRatingSummary } from "@/lib/api/ugc/reviews"
import { addToRecentViews } from "@/lib/api/users/recent-views"
import { isMembershipGroup } from "@/lib/utils/membership-group"
import { getIsVisibleToMembersOnly } from "@/lib/utils/product-card"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { siteConfig } from "@/lib/config/site"
import { Customer } from "@/lib/types/ui/medusa"
import { listProducts } from "@lib/api/medusa/products"
import { getRegion } from "@lib/api/medusa/regions"
import { Metadata } from "next"
import { notFound } from "next/navigation"

const PRODUCT_DETAIL_FIELDS =
  "*variants.calculated_price,+variants.inventory_quantity,+variants.manage_inventory,+variants.allow_backorder,+variants.metadata,*variants.options,*variants.images,+metadata,+tags,*categories,*categories.parent_category,*categories.parent_category.parent_category"

type Props = {
  params: Promise<{ countryCode: string; handle: string }>
  searchParams: Promise<{ v_id?: string }>
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params
  const { handle } = params
  const region = await getRegion(params.countryCode)

  if (!region) {
    notFound()
  }

  // fields 를 Page 와 똑같이 맞춰야 같은 캐시 항목을 공유한다. 다르면 같은 상품을
  // Medusa 에서 두 번 받아온다.
  const product = await listProducts({
    countryCode: params.countryCode,
    queryParams: { handle, fields: PRODUCT_DETAIL_FIELDS },
  }).then(({ response }) => response.products[0])

  if (!product) {
    notFound()
  }

  // Core PIM 의 SEO 입력값은 발행 시 Medusa product.metadata 로 넘어온다
  // (apps/medusa/src/scripts/lib/transformer.ts). 비어 있으면 상품명으로 폴백.
  const seo = product.metadata as
    | { seoTitle?: string; seoDescription?: string; seoKeywords?: string | string[] }
    | null
    | undefined
  const title = seo?.seoTitle || product.title
  const description = seo?.seoDescription || product.title

  return {
    title,
    description,
    // 정렬·필터 쿼리스트링이 붙은 변형 URL 이 중복으로 색인되지 않게 고정.
    alternates: {
      canonical: `/${params.countryCode}/products/${handle}`,
    },
    ...(seo?.seoKeywords ? { keywords: seo.seoKeywords } : {}),
    openGraph: {
      title,
      description,
      // thumbnail 은 fileId 문자열만 담고 있다. 그대로 넘기면 metadataBase 기준
      // 상대경로로 해석돼 https://almondyoung.com/{fileId} 라는 404 URL 이 나간다.
      // 비어 있으면 키 자체를 빼서 루트 레이아웃의 기본 OG 이미지가 적용되게 한다.
      ...(product.thumbnail
        ? { images: [getThumbnailUrl(product.thumbnail)] }
        : {}),
    },
  }
}

export default async function Page(props: Props) {
  const params = await props.params
  const region = await getRegion(params.countryCode)
  // const searchParams = await props.searchParams // 추후 사용자가 새로고침했을때 선택했던 variant를 유지하기위해 사용

  if (!region) {
    notFound()
  }

  const [pricedProduct, customer] = await Promise.all([
    listProducts({
      countryCode: params.countryCode,
      queryParams: { handle: params.handle, fields: PRODUCT_DETAIL_FIELDS },
    }).then(({ response }) => response.products[0]),
    retrieveCustomer(),
  ])

  if (!pricedProduct) {
    notFound()
  }

  if (getIsVisibleToMembersOnly(pricedProduct)) {
    // customer=null 은 '미인증' 또는 '회원인데 세션이 꼬여 조회 실패'를 모두 포함한다.
    // 이 경우 하드 404 대신 로그인/재인증으로 유도해 (회원이면) 그대로 상품에 복귀시킨다.
    // redirect_to 에 현재 상품 경로가 담긴다.
    if (!customer) {
      await redirectToLogin()
    } else if (!isMembershipGroup(customer.groups ?? [])) {
      // 로그인했지만 진짜 비회원 → 기존대로 숨김
      notFound()
    }
  }

  // 캐시 프라이밍 — 자식 컴포넌트들이 사용할 데이터를 미리 fetch 시작
  // React.cache()에 의해 동일 render 내 중복 호출은 이 Promise를 재사용
  const pimMasterId = pricedProduct.metadata?.pimMasterId as string
  // 평점 요약은 구조화 데이터(JSON-LD)에도 쓰므로 await 한다. ProductTemplate 자식의
  // 동일 호출은 React.cache() 로 재사용된다.
  const ratingSummary = pimMasterId
    ? await getRatingSummary(pimMasterId).catch(() => null)
    : null
  if (pimMasterId) {
    getQnaSummary(pimMasterId).catch(() => {})
    getProductDetailByMasterId(pimMasterId).catch(() => {})
  }

  // 로그인한 사용자만 최근 본 상품 기록
  if (customer) {
    addToRecentViews(pricedProduct.id).catch(() => {})
  }

  // 검색결과 별점(rich snippet) + AI 파싱용 구조화 데이터.
  // 리뷰 0개면 aggregateRating 을 빼서 빈 별점 패널티를 피한다.
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: pricedProduct.title,
    ...(pricedProduct.thumbnail ? { image: [pricedProduct.thumbnail] } : {}),
    url: `https://${siteConfig.domainName}/${params.countryCode}/products/${params.handle}`,
    ...(ratingSummary && ratingSummary.totalCount > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: ratingSummary.averageRating,
            reviewCount: ratingSummary.totalCount,
          },
        }
      : {}),
  }

  const viewPrice = getProductPrice({ product: pricedProduct }).cheapestPrice

  return (
    <div className="md:bg-muted/50 min-h-screen bg-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />
      <ViewItemTracker
        itemId={pricedProduct.id}
        itemName={pricedProduct.title}
        price={viewPrice?.calculated_price_number ?? 0}
        currency={toGaCurrency(viewPrice?.currency_code)}
      />
      <ProductTemplate
        product={pricedProduct}
        region={region}
        countryCode={params.countryCode}
        customer={customer as Customer | null}
      />
    </div>
  )
}
