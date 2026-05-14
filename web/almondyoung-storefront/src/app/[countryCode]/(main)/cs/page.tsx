import { Suspense } from "react"
import { siteConfig } from "@/lib/config/site"
import { getSEOTags } from "@/lib/seo"
import { CsHeader } from "@/domains/cs/components/cs-header"
import { CsTabs, CsTabPanel } from "@/domains/cs/components/cs-tabs"
import { Faq } from "@/domains/cs/components/faq"
import { Inquiry } from "@/domains/cs/components/inquiry"
import { Notice } from "@/domains/cs/components/notice"
import { listProducts } from "@/lib/api/medusa/products"

export const metadata = getSEOTags({
  title: `고객센터 | ${siteConfig.appName}`,
  openGraph: {},
  extraTags: {},
})

function CsTabsLoading() {
  return (
    <div className="flex h-12 w-full items-center justify-center border-b border-gray-200">
      <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
    </div>
  )
}

interface CsPageProps {
  params: Promise<{ countryCode: string }>
  searchParams: Promise<{ tab?: string; productId?: string }>
}

export default async function CsPage({ params, searchParams }: CsPageProps) {
  const { countryCode } = await params
  const { productId } = await searchParams

  const productPromise: Promise<{ id: string; title: string } | undefined> =
    productId
      ? listProducts({
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
      : Promise.resolve(undefined)

  const product = await productPromise

  return (
    <div className="min-h-screen bg-white">
      <CsHeader />

      <div className="mx-auto max-w-3xl bg-white">
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
