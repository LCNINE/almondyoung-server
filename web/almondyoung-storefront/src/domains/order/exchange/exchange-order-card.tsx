import { CustomButton } from "@components/common/custom-buttons"
import { MoreVertical } from "lucide-react"

interface ExchangeOrderCardProps {
  /** 상태 (예: "교환완료", "교환신청") */
  status: string
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
  /** 데스크탑 전용: 교환 날짜 */
  exchangeDate?: string
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
  /** 교환 상세보기 클릭 핸들러 */
  onExchangeDetailClick?: () => void
  /** 회수 조회 클릭 핸들러 */
  onTrackingClick?: () => void
  /** 배송 조회 클릭 핸들러 */
  onDeliveryTrackingClick?: () => void
}

/**
 * 교환 주문 카드 컴포넌트
 * 모바일과 데스크탑 UI를 모두 지원합니다.
 */
export function ExchangeOrderCard({
  status,
  productName,
  productImage,
  price,
  quantity,
  options = [],
  exchangeDate,
  orderDate,
  orderNumber,
  onOrderDetailClick,
  onMoreClick,
  onAddToCartClick,
  onExchangeDetailClick,
  onTrackingClick,
  onDeliveryTrackingClick,
}: ExchangeOrderCardProps) {
  return (
    <>
      {/* 모바일 카드 */}
      <div className="flex flex-col gap-2.5 rounded-[5px] border-[0.5px] border-[#d9d9d9] bg-white px-3 py-[15px] md:hidden">
        <div className="flex flex-col gap-5">
          {/* 상태 헤더 */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-[13px]">
              <h3 className="text-[13px] font-bold text-[#757575]">{status}</h3>
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
                  variant="outline"
                  color="secondary"
                  size="xs"
                  fullWidth={false}
                  onClick={onAddToCartClick}
                >
                  장바구니 담기
                </CustomButton>
              </div>
            </div>
          </div>

          {/* 하단 버튼 */}
          <div className="flex flex-col gap-2.5">
            <CustomButton
              variant="outline"
              color="primary"
              size="md"
              onClick={onExchangeDetailClick}
              fullWidth={true}
              className="flex-1"
            >
              교환 상세보기
            </CustomButton>
            <div className="flex gap-2.5">
              <CustomButton
                variant="outline"
                color="secondary"
                size="md"
                onClick={onTrackingClick}
                fullWidth={true}
                className="flex-1"
              >
                회수조회
              </CustomButton>
              <CustomButton
                variant="outline"
                color="secondary"
                size="md"
                fullWidth={false}
                onClick={onDeliveryTrackingClick}
                className="flex-1"
              >
                배송조회
              </CustomButton>
            </div>
          </div>
        </div>
      </div>

      {/* 데스크탑 카드 */}
      <div className="hidden flex-col gap-5 rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white p-5 md:flex">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-black">{exchangeDate} 교환</h2>
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
                    variant="outline"
                    color="secondary"
                    size="md"
                    fullWidth={false}
                    onClick={onAddToCartClick}
                  >
                    장바구니 담기
                  </CustomButton>
                </div>
              </div>
            </div>
          </div>

          <div className="h-[164px] w-px bg-[#d9d9d9]" aria-hidden="true" />

          <aside className="flex w-[126px] flex-col gap-2.5">
            <CustomButton
              variant="outline"
              color="primary"
              size="md"
              onClick={onExchangeDetailClick}
              fullWidth={true}
              className="flex-1"
            >
              교환 상세
            </CustomButton>
            <CustomButton
              variant="outline"
              color="secondary"
              size="md"
              onClick={onTrackingClick}
              fullWidth={true}
              className="flex-1"
            >
              회수 조회
            </CustomButton>
            <CustomButton
              variant="outline"
              color="secondary"
              size="md"
              onClick={onDeliveryTrackingClick}
              fullWidth={true}
              className="flex-1"
            >
              배송 조회
            </CustomButton>
          </aside>
        </section>
      </div>
    </>
  )
}
