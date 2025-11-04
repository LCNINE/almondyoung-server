import Image from "next/image"
import { Button } from "@components/common/ui/button"
import type { ProductInfo, BenefitInfo } from "../types"

interface ReviewCardBeforeWrittenProps {
  product: ProductInfo
  benefit: BenefitInfo
  onWriteReview: () => void
}

/**
 * 작성 가능한 리뷰 아이템을 표시하는 시맨틱 카드 컴포넌트
 */
export const ReviewCardBeforeWritten = ({
  product,
  benefit,
  onWriteReview,
}: ReviewCardBeforeWrittenProps) => {
  const formattedPoints = new Intl.NumberFormat("ko-KR").format(benefit.points)
  const shouldShowPurchaseDate = Boolean(product.purchaseDate)

  return (
    <article className="w-full bg-[#FFFFFF]">
      <div className="flex flex-col gap-3 p-4">
        {/* 상품 정보 섹션 */}
        <section className="flex items-start gap-3">
          <figure className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-md border border-[#F0F0F0]">
            <Image
              src={product.imageUrl}
              alt={`${product.title} 썸네일`}
              width={96}
              height={96}
              className="object-cover"
            />
          </figure>

          <div className="flex-1">
            <p className="mb-[2px] text-[13px] text-[#666666]">
              {product.storeName}
            </p>
            <h3 className="line-clamp-2 text-[15px] leading-[22px] font-bold text-[#1A1A1A]">
              {product.title}
            </h3>
            <p className="mt-[4px] text-[13px] text-[#666666]">
              {product.options}
            </p>
            {shouldShowPurchaseDate && (
              <dl className="mt-[2px] flex text-[13px] text-[#666666]">
                <dt>구매확정 :&nbsp;</dt>
                <dd>{product.purchaseDate}</dd>
              </dl>
            )}
          </div>
        </section>

        {/* 혜택 및 액션 버튼 섹션 */}
        <section className="flex items-end justify-between">
          <div>
            <p className="text-[14px] font-medium text-[#333333]">
              포인트 최대{" "}
              <strong className="text-[15px] font-bold text-[#FF9500]">
                {formattedPoints}원
              </strong>
            </p>
            <p className="mt-0.5 text-[13px] text-[#666666]">
              작성기한 {benefit.deadline} (D-{benefit.dDay})
            </p>
          </div>

          <Button
            variant="outline"
            onClick={onWriteReview}
            className="h-[36px] border-[#FF9500] px-4 text-[14px] font-medium text-[#FF9500] hover:bg-[#FF9500]/10 hover:text-[#FF9500] focus-visible:ring-[#FF9500]/50"
          >
            리뷰쓰기
          </Button>
        </section>
      </div>
    </article>
  )
}
