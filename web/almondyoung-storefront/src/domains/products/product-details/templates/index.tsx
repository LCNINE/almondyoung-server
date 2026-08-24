import { QnaList } from "@/components/qna/qna-list"
import { FEATURES } from "@/lib/config/features"
import { ErrorBoundary } from "@/components/shared/error-boundary"
import { ProductReviewSkeleton } from "@/components/skeletons/product-detail-skeletons"
import type { ProductDetail } from "@/lib/types/ui/pim"
import { Customer } from "@/lib/types/ui/medusa"
import { isMembershipGroup } from "@/lib/utils/membership-group"
import { isDigitalProduct } from "@/lib/api/medusa/shipping-method-policy"
import { getIsOverseas } from "@/lib/utils/product-card"
import { HttpTypes } from "@medusajs/types"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { Suspense } from "react"
import { ImageGallery } from "../components/image-gallery"
import { ProductBreadcrumb } from "../components/breadcrumb"
import ProductActions from "../components/product-actions"
import { ProductInfoAccordion } from "../components/product-detail-info/product-info-accordion"
import ProductPreviewPrice from "../components/product-preview-price"
import { ProductShippingNotice } from "../components/product-shipping-notice"
import { SectionTabPanel } from "../components/section-nav"
import { ProductSummary } from "../components/product-summary"
import ProductActionsWrapper from "./product-actions-wrappers/product-actions-wrapper"
import { ProductDetailInfoWrapper } from "./product-actions-wrappers/product-detail-info-wrapper"
import { ReviewPreviewWrapper } from "./product-actions-wrappers/review-preview-wrapper"
import { ReviewSectionWrapper } from "./product-actions-wrappers/review-section-wrapper"
import { SectionTabsWrapper } from "./product-actions-wrappers/section-tabs-wrapper"

type ProductTemplateProps = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  countryCode: string
  customer: Customer | null
  pimDetail: ProductDetail | null
}

export async function ProductTemplate({
  product,
  region,
  countryCode,
  customer,
  pimDetail,
}: ProductTemplateProps) {
  if (!product || !product.id) {
    return notFound()
  }

  const t = await getTranslations("productDetail.section")
  const isDigital = isDigitalProduct(product)
  const isOverseas = getIsOverseas(product)

  return (
    <div className="min-h-screen bg-white pt-6">
      <div className="mx-auto max-w-[1360px] px-[15px] xl:px-[40px]">
        <ProductBreadcrumb product={product} />

        <div className="py-2 xl:flex xl:items-start xl:gap-4">
          {/* 메인 콘텐츠 */}
          <main className="w-full min-w-0 flex-1 pb-24 xl:pb-0">
            <ImageGallery product={product} />

            {/* 모바일 상품 정보 */}
            <div className="xl:hidden">
              <ProductSummary
                brand={(product.metadata?.brand as string) ?? ""}
                productName={product.title ?? ""}
                productId={product.id}
                pimMasterId={product.metadata?.pimMasterId as string}
                countryCode={countryCode}
                customer={customer}
                isDigital={isDigital}
                isOverseas={isOverseas}
                isPrimaryHeading
              >
                <ProductPreviewPrice
                  hasMembership={isMembershipGroup(customer?.groups)}
                  product={product}
                />
                <ProductShippingNotice product={product} />
              </ProductSummary>
            </div>

            <Suspense fallback={null}>
              <ReviewPreviewWrapper
                productId={product.metadata?.pimMasterId as string}
              />
            </Suspense>

            <SectionTabsWrapper
              productId={product.metadata?.pimMasterId as string}
            >
              {/* 상품 상세정보 Tab Panel — 데이터를 page 가 이미 await 하므로 별도
                  Suspense 없이 페이지 본문과 같은 청크로 렌더한다 (지연 스왑 1단계 제거) */}
              <SectionTabPanel value="detail">
                <ErrorBoundary fallback={<div>{t("loadDetailFail")}</div>}>
                  <ProductDetailInfoWrapper
                    pricedProduct={product}
                    pimDetail={pimDetail}
                  />
                </ErrorBoundary>

                <ProductInfoAccordion productMetadata={product.metadata} />
              </SectionTabPanel>

              {/* 리뷰 Tab Panel */}
              <SectionTabPanel value="review">
                <ErrorBoundary fallback={<div>{t("loadReviewFail")}</div>}>
                  <Suspense fallback={<ProductReviewSkeleton />}>
                    <ReviewSectionWrapper
                      productId={product.metadata?.pimMasterId as string}
                      countryCode={countryCode}
                    />
                  </Suspense>
                </ErrorBoundary>
              </SectionTabPanel>

              {/* Q&A Tab Panel — QnA 기능을 닫은 동안 미노출 */}
              {FEATURES.qna && (
                <SectionTabPanel value="qna">
                  <QnaList
                    productId={product.metadata?.pimMasterId as string}
                    productName={product.title ?? ""}
                    productThumbnail={product.thumbnail ?? null}
                  />
                </SectionTabPanel>
              )}
            </SectionTabsWrapper>
          </main>

          <div className="xl:sticky xl:top-[216px] xl:flex xl:h-[calc(100vh-216px)] xl:w-full xl:max-w-[480px] xl:min-w-[383px] xl:flex-col xl:overflow-hidden">
            <div className="hidden xl:flex xl:shrink-0 xl:flex-col">
              <ProductSummary
                brand={(product.metadata?.brand as string) ?? ""}
                productName={product.title ?? ""}
                productId={product.id}
                pimMasterId={product.metadata?.pimMasterId as string}
                countryCode={countryCode}
                customer={customer}
                isDigital={isDigital}
                isOverseas={isOverseas}
              />
            </div>

            <Suspense
              fallback={
                <ProductActions
                  customer={customer}
                  product={product}
                  region={region}
                  disabled={false}
                />
              }
            >
              <ProductActionsWrapper
                handle={product.handle!}
                region={region}
                customer={customer}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  )
}
