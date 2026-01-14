"use client"

import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import {
  OrderInfoCardRoot,
  OrderInfoCardRow,
  OrderInfoCardRowItem,
  OrderInfoCardDivider,
} from "@components/orders/order-info-card.atomic"

// 아이콘은 SVG나 아이콘 라이브러리로 교체해주세요.
const TalkIcon = () => <span>💬</span>
const CartIcon = () => <span>🛒</span>
const UpArrowIcon = () => <span>🔼</span>

/**
 * OrderDetailsMobile - 주문 상세 모바일 컴포넌트
 *
 * 모바일 최적화된 레이아웃
 */
export const OrderDetailsMobile = () => {
  return (
    // Container: 페이지 전체 컨테이너
    <main className="relative min-h-screen w-full bg-[#f8f8f8] font-sans">
      {/* Inner: 실제 콘텐츠 영역 */}
      <div className="p-4 pb-24">
        {/* --- 주문일자 및 번호 --- */}
        <header className="mb-3 flex items-center justify-between text-sm">
          <h2 className="text-[13px] font-bold text-gray-800">
            2025. 5. 14 주문
          </h2>
          <span className="text-gray-500">주문번호 20102-202031</span>
        </header>

        {/* --- 결제 정보 카드 --- */}
        <section aria-labelledby="payment-details-title">
          <h3 id="payment-details-title" className="sr-only">
            결제 정보
          </h3>
          <OrderInfoCardRoot className="p-4">
            <OrderInfoCardRow className="mb-2">
              <OrderInfoCardRowItem className="text-gray-500">
                총 상품 가격
              </OrderInfoCardRowItem>
              <OrderInfoCardRowItem className="text-right text-gray-800">
                18,000 원
              </OrderInfoCardRowItem>
            </OrderInfoCardRow>
            <OrderInfoCardRow className="mb-2">
              <OrderInfoCardRowItem className="text-gray-500">
                배송비
              </OrderInfoCardRowItem>
              <OrderInfoCardRowItem className="text-right text-gray-800">
                2,500 원
              </OrderInfoCardRowItem>
            </OrderInfoCardRow>
            <OrderInfoCardRow className="mb-2">
              <OrderInfoCardRowItem className="text-gray-500">
                펌뱅킹 / 익월 이체
              </OrderInfoCardRowItem>
              <OrderInfoCardRowItem className="text-right text-gray-800">
                20,500 원
              </OrderInfoCardRowItem>
            </OrderInfoCardRow>
            <OrderInfoCardRow>
              <OrderInfoCardRowItem className="font-bold text-gray-800">
                총 결제 금액
              </OrderInfoCardRowItem>
              <OrderInfoCardRowItem className="text-right font-bold text-gray-800">
                20,500 원
              </OrderInfoCardRowItem>
            </OrderInfoCardRow>
          </OrderInfoCardRoot>
        </section>

        {/* --- 영수증 보기 버튼 --- */}
        <button className="mt-[11px] mb-[10px] w-full rounded-[5px] border border-solid bg-[#fff] px-[131.9px] py-[11.1px]">
          <span className="mr-[4px] text-sm font-semibold text-gray-700">
            영수증 보기
          </span>
          <span className="text-sm font-semibold text-gray-700">&gt;</span>
        </button>

        {/* --- 배송 정보 카드 --- */}
        <section aria-labelledby="shipping-info-title" className="mt-3">
          <OrderInfoCardRoot className="p-4">
            <h3
              id="shipping-info-title"
              className="text-base font-bold text-gray-800"
            >
              이연정
            </h3>
            <p className="mt-2 text-sm text-gray-600">
              (10303) 서울특별시 강북구 도봉로 89길 27(수유동)4층
            </p>
            <p className="mt-1 text-sm text-gray-600">010-0000-0000</p>
            <OrderInfoCardDivider />
            <dl className="flex text-sm">
              <dt className="w-24 shrink-0 text-gray-500">배송요청사항</dt>
              <dd className="text-gray-800">부재 시 문앞에 놔주세요.</dd>
            </dl>
          </OrderInfoCardRoot>
        </section>

        {/* --- 상품 상세 및 주문관리 카드 --- */}
        <section
          aria-labelledby="product-details-title"
          className="mt-3 rounded-lg bg-white shadow-sm"
        >
          <div className="p-4">
            <div className="flex items-center justify-between">
              <h3
                id="product-details-title"
                className="font-bold text-gray-800"
              >
                상품준비중
              </h3>
              <a href="#" className="text-sm font-semibold text-green-600">
                당일 출고 보장
              </a>
            </div>
            <p className="mt-3 text-sm font-bold text-gray-500">
              분리배송 상품
            </p>
          </div>

          <div className="border-border-muted border-t p-4">
            <div className="flex gap-3">
              <img
                src="https://via.placeholder.com/160x160/f0f0f0/cccccc?text=Product"
                alt="노모드 속눈썹 영양제 블랙"
                className="h-20 w-20 shrink-0 rounded-md"
              />
              <div className="flex-grow">
                <p className="font-semibold text-gray-800">
                  노모드 속눈썹 영양제 블랙
                </p>
                <p className="mt-1 text-sm text-gray-500">9,000원 · 2개</p>
                <p className="mt-1 text-xs text-gray-400">- 브러쉬 타입 1개</p>
                <p className="text-xs text-gray-400">- 마스카라 타입 1개</p>
              </div>
              <CustomButton variant="outline" size="sm">
                장바구니 담기
              </CustomButton>
            </div>
          </div>

          <div className="border-border-muted mt-2 flex gap-2 border-t p-4">
            <CustomButton variant="outline" size="lg">
              주문 취소 / 반품 신청
            </CustomButton>
            <CustomButton variant="outline" size="lg">
              배송 조회
            </CustomButton>
          </div>
        </section>
      </div>

      {/* --- 플로팅 버튼들 --- */}
      <div className="fixed right-4 bottom-24 z-10 flex flex-col gap-2">
        <button className="flex h-12 w-12 items-center justify-center rounded-full bg-yellow-300 shadow-lg">
          <span className="font-bold">TALK</span>
        </button>
        <button className="relative flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-white shadow-lg">
          <CartIcon />
          <span className="absolute top-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-xs text-white">
            2
          </span>
        </button>
        <button className="flex h-12 w-12 items-center justify-center rounded-full border border-gray-200 bg-white shadow-lg">
          <UpArrowIcon />
        </button>
      </div>
    </main>
  )
}
