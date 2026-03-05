import { ErrorBoundary } from "@/components/shared/error-boundary"
import {
  ProductDetailInfoSkeleton,
  ProductQnaSkeleton,
  ProductReviewSkeleton,
  RatingSkeleton,
} from "@/components/skeletons/product-detail-skeletons"
import { Customer } from "@/lib/types/ui/medusa"
import { isMembershipGroup } from "@/lib/utils/membership-group"
import { HttpTypes } from "@medusajs/types"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { WishlistButton } from "../components/actions/wishlist-button"
import { ImageGallery } from "../components/image-gallery"
import ProductActions from "../components/product-actions"
import { ProductInfoAccordion } from "../components/product-detail-info/product-info-accordion"
import ProductDetailPrice from "../components/product-detail-price"
import { SectionTabPanel } from "../components/section-nav"
import { SideBar } from "../components/side-bar"
import ProductActionsWrapper from "./product-actions-wrappers/product-actions-wrapper"
import { ProductDetailInfoWrapper } from "./product-actions-wrappers/product-detail-info-wrapper"
import { QnaSectionWrapper } from "./product-actions-wrappers/qna-section-wrapper"
import { RatingActionsWrapper } from "./product-actions-wrappers/rating-actions-wrapper"
import { ReviewSectionWrapper } from "./product-actions-wrappers/review-section-wrapper"
import { SectionTabsWrapper } from "./product-actions-wrappers/section-tabs-wrapper"
import { WishlistChatActionsWrapper } from "./product-actions-wrappers/wishlist-chat-actions-wrapper"

type ProductTemplateProps = {
  product: HttpTypes.StoreProduct
  region: HttpTypes.StoreRegion
  countryCode: string
  customer: Customer | null
}

export function ProductTemplate({
  product,
  region,
  countryCode,
  customer,
}: ProductTemplateProps) {
  if (!product || !product.id) {
    return notFound()
  }

  return (
    <div className="min-h-screen bg-white pt-6">
      <div className="mx-auto max-w-[1360px] px-[15px] lg:px-[40px]">
        <div className="py-2 lg:flex lg:gap-4">
          {/* 메인 콘텐츠 */}
          <main className="w-full min-w-0 flex-1 pb-24 lg:pb-0">
            <ImageGallery product={product} />

            {/* 모바일 상품 정보 */}
            <div className="lg:hidden">
              <div className="flex min-w-0 flex-1 items-center gap-4">
                <p className="text-sm text-gray-600">
                  {(product.metadata?.brand as string) ?? ""}
                </p>
                <div className="ml-auto">
                  <Suspense
                    fallback={
                      <>
                        <WishlistButton
                          productId={product.id}
                          isWishlisted={false}
                          countryCode={countryCode}
                        />
                      </>
                    }
                  >
                    <WishlistChatActionsWrapper
                      productId={product.id}
                      countryCode={countryCode}
                    />
                  </Suspense>
                </div>
              </div>

              <h4>{product.title}</h4>

              <Suspense fallback={<RatingSkeleton />}>
                <RatingActionsWrapper handle={product.handle} />
              </Suspense>

              <ProductDetailPrice
                hasMembership={isMembershipGroup(customer?.groups)}
                product={product}
                selectedVariant={product.variants?.[0]}
              />
            </div>

            <SectionTabsWrapper
              productId={product.metadata?.pimMasterId as string}
            >
              {/* 상품 상세정보 Tab Panel */}
              <SectionTabPanel value="detail">
                <ErrorBoundary
                  fallback={<div>상품 정보를 불러오지 못했습니다.</div>}
                >
                  <Suspense fallback={<ProductDetailInfoSkeleton />}>
                    <ProductDetailInfoWrapper pricedProduct={product} />
                  </Suspense>
                </ErrorBoundary>

                <ProductInfoAccordion />
              </SectionTabPanel>

              {/* 리뷰 Tab Panel */}
              <SectionTabPanel value="review">
                <ErrorBoundary
                  fallback={<div>리뷰를 불러오지 못했습니다.</div>}
                >
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
                <ErrorBoundary fallback={<div>Q&A를 불러오지 못했습니다.</div>}>
                  <Suspense fallback={<ProductQnaSkeleton />}>
                    <QnaSectionWrapper product={product} />
                  </Suspense>
                </ErrorBoundary>
              </SectionTabPanel>
            </SectionTabsWrapper>
          </main>

          <div className="lg:sticky lg:top-0 lg:max-h-screen lg:w-full lg:max-w-[480px] lg:min-w-[383px] lg:overflow-y-auto">
            <div className="hidden lg:block">
              <SideBar
                brand={(product.metadata?.brand as string) ?? ""}
                productName={product.title ?? ""}
                productId={product.id}
                countryCode={countryCode}
                handle={product.handle}
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
