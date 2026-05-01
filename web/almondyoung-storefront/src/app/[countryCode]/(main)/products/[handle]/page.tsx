import { ProductTemplate } from "@/domains/products/product-details/templates"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getProductDetailByMasterId } from "@/lib/api/pim/products"
import { getQnaSummary } from "@/lib/api/ugc"
import { getRatingSummary } from "@/lib/api/ugc/reviews"
import { addToRecentViews } from "@/lib/api/users/recent-views"
import { Customer } from "@/lib/types/ui/medusa"
import { listProducts } from "@lib/api/medusa/products"
import { getRegion } from "@lib/api/medusa/regions"
import { Metadata } from "next"
import { notFound } from "next/navigation"

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

  const product = await listProducts({
    countryCode: params.countryCode,
    queryParams: { handle },
  }).then(({ response }) => response.products[0])

  if (!product) {
    notFound()
  }

  return {
    title: `${product.title}`,
    description: `${product.title}`,
    openGraph: {
      title: `${product.title}`,
      description: `${product.title}`,
      images: product.thumbnail ? [product.thumbnail] : [],
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
      queryParams: { handle: params.handle },
    }).then(({ response }) => response.products[0]),
    retrieveCustomer(),
  ])

  if (!pricedProduct) {
    notFound()
  }

  // 캐시 프라이밍 — 자식 컴포넌트들이 사용할 데이터를 미리 fetch 시작
  // React.cache()에 의해 동일 render 내 중복 호출은 이 Promise를 재사용
  const pimMasterId = pricedProduct.metadata?.pimMasterId as string
  if (pimMasterId) {
    getRatingSummary(pimMasterId).catch(() => {})
    getQnaSummary(pimMasterId).catch(() => {})
    getProductDetailByMasterId(pimMasterId).catch(() => {})
  }

  // 로그인한 사용자만 최근 본 상품 기록
  if (customer) {
    addToRecentViews(pricedProduct.id).catch(() => {})
  }

  return (
    <div className="md:bg-muted/50 min-h-screen bg-white">
      <ProductTemplate
        product={pricedProduct}
        region={region}
        countryCode={params.countryCode}
        customer={customer as Customer | null}
      />
    </div>
  )
}
