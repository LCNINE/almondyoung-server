import { Suspense } from "react"
import { getTranslations } from "next-intl/server"
import { siteConfig } from "@/lib/config/site"
import { getSEOTags } from "@/lib/seo"
import { CsHeader } from "@/domains/cs/components/cs-header"
import { CsTabs, CsTabPanel } from "@/domains/cs/components/cs-tabs"
import { Faq } from "@/domains/cs/components/faq"
import { Inquiry } from "@/domains/cs/components/inquiry"
import { Notice } from "@/domains/cs/components/notice"
import { listProducts } from "@/lib/api/medusa/products"

export async function generateMetadata() {
  const t = await getTranslations("cs")
  return getSEOTags({
    title: `${t("metaTitle")} | ${siteConfig.appName}`,
    openGraph: {},
    extraTags: {},
  })
}

function CsTabsLoading() {
  return (
    <div className="flex items-center justify-center w-full h-12 border-b border-gray-200">
      <div className="w-24 h-4 bg-gray-200 rounded animate-pulse" />
    </div>
  )
}

interface CsPageProps {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{
    tab?: string
    productId?: string
    productName?: string
  }>
}

export default async function CsPage({ params, searchParams }: CsPageProps) {
  const { countryCode } = await params
  const { productId, productName } = await searchParams

  // 상품 문의 진입 시 productId 는 pimMasterId(문의에 저장되는 값)로 전달된다.
  // 상품명까지 같이 넘어오면(상품 상세 → 1:1 문의 경로) 재조회 없이 그대로 사용.
  // productName 없이 productId 만 있는 레거시/외부 진입은 handle 로 재조회해 보정.
  const productPromise: Promise<{ id: string; title: string } | undefined> =
    !productId
      ? Promise.resolve(undefined)
      : productName
        ? Promise.resolve({ id: productId, title: productName })
        : listProducts({
            countryCode,
            queryParams: { handle: productId },
          })
            .then(({ response }) => {
              const productData = response.products[0]
              const pimMasterId = productData?.metadata?.pimMasterId as
                | string
                | undefined
              return pimMasterId
                ? { id: pimMasterId, title: productData.title }
                : undefined
            })
            .catch(() => undefined)

  const product = await productPromise

  return (
    <div className="min-h-screen bg-white">
      <CsHeader />

      <div className="max-w-3xl mx-auto bg-white">
        <Suspense fallback={<CsTabsLoading />}>
          <CsTabs>
            <CsTabPanel value="faq">
              <Faq />
            </CsTabPanel>

            <CsTabPanel value="inquiry">
              <Inquiry product={product} />
            </CsTabPanel>

            <CsTabPanel value="notice">
              <Notice />
            </CsTabPanel>
          </CsTabs>
        </Suspense>
      </div>
    </div>
  )
}
