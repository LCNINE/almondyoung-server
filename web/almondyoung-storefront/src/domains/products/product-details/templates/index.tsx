import { QnaList } from "@/components/qna/qna-list"
import { ErrorBoundary } from "@/components/shared/error-boundary"
import {
  ProductDetailInfoSkeleton,
  ProductReviewSkeleton,
} from "@/components/skeletons/product-detail-skeletons"
import { Customer } from "@/lib/types/ui/medusa"
import { isMembershipGroup } from "@/lib/utils/membership-group"
import { HttpTypes } from "@medusajs/types"
import { notFound } from "next/navigation"
import { getTranslations } from "next-intl/server"
import { Suspense } from "react"
import { ImageGallery } from "../components/image-gallery"
import ProductActions from "../components/product-actions"
import { ProductInfoAccordion } from "../components/product-detail-info/product-info-accordion"
import ProductPreviewPrice from "../components/product-preview-price"
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
}

export async function ProductTemplate({
  product,
  region,
  countryCode,
  customer,
}: ProductTemplateProps) {
  if (!product || !product.id) {
    return notFound()
  }

  const t = await getTranslations("productDetail.section")

  return (
    <div className="min-h-screen bg-white pt-6">
      <div className="mx-auto max-w-[1360px] px-[15px] lg:px-[40px]">
        <div className="py-2 lg:flex lg:gap-4">
          {/* 메인 콘텐츠 */}
          <main className="w-full min-w-0 flex-1 pb-24 lg:pb-0">
            <ImageGallery product={product} />

            {/* 모바일 상품 정보 */}
            <div className="lg:hidden">
              <ProductSummary
                brand={(product.metadata?.brand as string) ?? ""}
                productName={product.title ?? ""}
                productId={product.id}
                pimMasterId={product.metadata?.pimMasterId as string}
                countryCode={countryCode}
                customer={customer}
              >
                <ProductPreviewPrice
                  hasMembership={isMembershipGroup(customer?.groups)}
                  product={product}
                />
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
              {/* 상품 상세정보 Tab Panel */}
              <SectionTabPanel value="detail">
                <ErrorBoundary fallback={<div>{t("loadDetailFail")}</div>}>
                  <Suspense fallback={<ProductDetailInfoSkeleton />}>
                    <ProductDetailInfoWrapper pricedProduct={product} />
                  </Suspense>
                </ErrorBoundary>

                <ProductInfoAccordion />
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

              {/* Q&A Tab Panel */}
              <SectionTabPanel value="qna">
                <QnaList
                  productId={product.metadata?.pimMasterId as string}
                  productName={product.title ?? ""}
                  productThumbnail={product.thumbnail ?? null}
                />
              </SectionTabPanel>
            </SectionTabsWrapper>
          </main>

          <div className="lg:sticky lg:top-0 lg:max-h-screen lg:w-full lg:max-w-[480px] lg:min-w-[383px] lg:overflow-hidden">
            <div className="hidden lg:block">
              <ProductSummary
                brand={(product.metadata?.brand as string) ?? ""}
                productName={product.title ?? ""}
                productId={product.id}
                pimMasterId={product.metadata?.pimMasterId as string}
                countryCode={countryCode}
                customer={customer}
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
                id={product.id}
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
