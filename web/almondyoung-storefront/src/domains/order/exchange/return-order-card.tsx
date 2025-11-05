import { MoreVertical } from "lucide-react"
import { CustomButton } from "@components/common/custom-buttons"

/** ============================================
 * 반품 카드 컴포넌트
 * ============================================ */

interface ReturnOrderCardProps {
  /** 상태 (예: "반품완료", "반품신청") */
  status: string
  /** 추가 정보 (예: "2/17(월) 이내 카드사 환불 완료 예정") */
  statusInfo?: string
  /** 상품명 */
  productName: string
  /** 상품 이미지 URL */
  productImage: string
  /** 가격 (포맷된 문자열) */
  price: string
  /** 수량 */
  quantity: number | string
  /** 상품 옵션 배열 */
  options?: string[]
  /** 데스크탑 전용: 반품 날짜 */
  returnDate?: string
  /** 데스크탑 전용: 주문일 */
  orderDate?: string
  /** 데스크탑 전용: 주문번호 */
  orderNumber?: string
  /** 주문 상세보기 클릭 핸들러 */
  onOrderDetailClick?: () => void
  /** 더보기 클릭 핸들러 */
  onMoreClick?: () => void
  /** 장바구니 담기 클릭 핸들러 */
  onAddToCartClick?: () => void
  /** 반품 상세보기 클릭 핸들러 */
  onReturnDetailClick?: () => void
  /** 회수 조회 클릭 핸들러 */
  onTrackingClick?: () => void
  /** 반품 철회 클릭 핸들러 (데스크탑 전용) */
  onCancelReturnClick?: () => void
}

/**
 * 반품 주문 카드 컴포넌트
 * 모바일과 데스크탑 UI를 모두 지원합니다.
 */
export function ReturnOrderCard({
  status,
  statusInfo,
  productName,
  productImage,
  price,
  quantity,
  options = [],
  returnDate,
  orderDate,
  orderNumber,
  onOrderDetailClick,
  onMoreClick,
  onAddToCartClick,
  onReturnDetailClick,
  onTrackingClick,
  onCancelReturnClick,
}: ReturnOrderCardProps) {
  return (
    <>
      {/* 모바일 카드 */}
      <div className="flex flex-col gap-2.5 rounded-[5px] border-[0.5px] border-[#d9d9d9] bg-white px-3 py-[15px] md:hidden">
        <div className="flex flex-col gap-5">
          {/* 상태 헤더 */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-[13px]">
              <h3 className="text-[13px] font-bold text-[#757575]">{status}</h3>
              {statusInfo && (
                <p className="text-[13px] text-[#48484a]">{statusInfo}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onMoreClick}
              className="h-5 w-5 shrink-0"
              aria-label="더보기"
            >
              <MoreVertical className="h-5 w-5 text-[#757575]" />
            </button>
          </div>

          {/* 상품 카드 */}
          <div className="flex gap-2.5">
            <figure className="shrink-0">
              <img
                className="h-[73px] w-[72px] rounded-[5px] object-cover"
                src={productImage}
                alt={productName}
              />
            </figure>

            <div className="flex flex-1 flex-col gap-[9px]">
              <h4 className="text-sm text-black">{productName}</h4>

              <div className="flex items-end justify-between">
                <div className="flex-1 text-xs text-[#757575]">
                  <p>
                    {price} · {quantity}개
                  </p>
                  {options?.map((option, index) => (
                    <p key={index}>- {option}</p>
                  ))}
                </div>

                <CustomButton
                  variant="secondary"
                  size="md"
                  onClick={onAddToCartClick}
                >
                  장바구니 담기
                </CustomButton>
              </div>
            </div>
          </div>

          {/* 하단 버튼 */}
          <div className="flex gap-2.5">
            <CustomButton
              variant="secondary"
              size="md"
              onClick={onReturnDetailClick}
              fullWidth={true}
            >
              반품 상세보기
            </CustomButton>
          </div>
        </div>
      </div>

      {/* 데스크탑 카드 */}
      <div className="hidden flex-col gap-5 rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white p-5 md:flex">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-black">{returnDate} 반품</h2>
          <button
            type="button"
            onClick={onOrderDetailClick}
            className="text-base text-black hover:underline"
          >
            주문 상세보기 &gt;
          </button>
        </header>

        <section className="flex items-center gap-[30px] rounded-[5px] border-[0.5px] border-[#d9d9d9] bg-white px-5 py-[15px]">
          <div className="flex flex-1 flex-col gap-5">
            <div>
              <h3 className="text-lg font-bold text-black">{status}</h3>
            </div>

            <div className="flex gap-[13px]">
              <p className="text-base text-black">
                주문일 : <span className="font-bold">{orderDate}</span>
              </p>
              <p className="text-base text-black">
                주문번호 : <span className="font-bold">{orderNumber}</span>
              </p>
            </div>

            <div className="flex gap-[15px]">
              <figure className="shrink-0">
                <img
                  className="h-[73px] w-[72px] rounded-[5px] object-cover"
                  src={productImage}
                  alt={productName}
                />
              </figure>

              <div className="flex flex-1 flex-col gap-[9px]">
                <h4 className="text-base text-black">{productName}</h4>

                <div className="flex items-end justify-between">
                  <div className="min-w-[120px] text-sm text-[#757575]">
                    <p>
                      {price} · {quantity}개
                    </p>
                    {options?.map((option, index) => (
                      <p key={index}>- {option}</p>
                    ))}
                  </div>

                  <CustomButton
                    variant="secondary"
                    onClick={onAddToCartClick}
                    size="md"
                    fullWidth={true}
                  >
                    장바구니 담기
                  </CustomButton>
                </div>
              </div>
            </div>
          </div>

          <div className="h-[145px] w-px bg-[#d9d9d9]" aria-hidden="true" />

          <aside className="flex w-[126px] flex-col gap-2.5">
            <CustomButton
              variant="secondary"
              size="md"
              fullWidth={true}
              onClick={onTrackingClick}
            >
              회수 조회
            </CustomButton>
            <CustomButton
              variant="secondary"
              size="md"
              fullWidth={true}
              onClick={onCancelReturnClick}
            >
              반품 철회
            </CustomButton>
          </aside>
        </section>
      </div>
    </>
  )
}
