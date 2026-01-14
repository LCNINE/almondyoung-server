"use client"
import CheckoutHeader from "@/app/[countryCode]/(checkout)/checkout/checkout-header"
import { Rating } from "@components/rating"
import { useRating } from "@components/rating/use-rating-hooks"
import OrderSuccessContainer from "domains/order/success/components/order-success-container"

/**
 * 헬퍼 컴포넌트: 가독성을 위해 복잡한 SVG를 분리
 * (단일 태그에 과도한 마크업 중첩 방지)
 */
function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      preserveAspectRatio="none"
    >
      <path
        d="M6 9L12 15L18 9"
        stroke="black"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/**
 * 헬퍼 컴포넌트: 주문 요약 카드
 * - `absolute` 대신 `flex-col`과 `divide-y`로 구조화
 * - <dl>, <details>, <summary> 시맨틱 태그 사용
 */
function OrderSummaryCard() {
  return (
    // <section> 태그: 주문 요약 정보를 담는 독립된 섹션
    // w-[816px] 고정 너비는 디자인 요청에 따라 유지
    <section className="w-[816px] overflow-hidden rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white">
      {/* div 중첩 대신 flex-col과 divide-y로 섹션을 명확히 분리 
        (1개의 태그에 CSS가 과도하게 중첩되는 것을 방지)
      */}
      <div className="flex flex-col divide-y-[0.5px] divide-[#d9d9d9]">
        {/* 1. 주문번호 헤더 */}
        <header className="flex items-center justify-between px-8 pt-8 pb-6">
          {/* <h2> 태그: 섹션의 제목 */}
          <h2 className="text-lg text-black">
            <span className="font-bold">주문번호 </span>
            <span>20253934092938</span>
          </h2>
        </header>

        {/* 2. 배송 정보: <dl> (정의 목록) 사용 */}
        <div className="px-8 py-6">
          <dl>
            <div className="flex items-center justify-between">
              <dt className="sr-only">수령인</dt>
              <dd className="text-lg font-bold text-black">이연정 (이연정)</dd>
              <dd>
                <button
                  type="button"
                  className="rounded-[3px] border border-[#aeaeb2] bg-white px-2.5 py-1.5 text-center text-[13px] font-medium text-[#1e1e1e]"
                >
                  변경
                </button>
              </dd>
            </div>
            {/* mt-4, mt-2로 `absolute` top 위치를 대체 */}
            <div className="mt-4">
              <dt className="sr-only">연락처</dt>
              <dd className="text-base text-black">010-0000-0000</dd>
            </div>
            <div className="mt-2">
              <dt className="sr-only">배송 주소</dt>
              <dd className="text-base text-black">
                서울특별시 강북구 도봉로 89길 27(수유동) 4층
              </dd>
            </div>
          </dl>
        </div>

        {/* 3. 주문 상품: <details> (접기/펴기) 사용 */}
        <details className="group">
          {/* <summary> 태그: 접기/펴기 토글 영역 */}
          <summary className="flex cursor-pointer list-none items-center justify-between p-8">
            <div className="flex items-center gap-6">
              <img
                className="h-[99px] w-[99px] rounded-[5px] object-cover"
                src="affd16fd5264cab9197da4cd1a996f820e601ee4-2.png"
                alt="주문 상품 대표 이미지" // alt 태그 추가
              />
              <p className="text-lg text-black">주문상품 1건</p>
            </div>
            <ChevronDownIcon className="transition-transform group-open:rotate-180" />
          </summary>
          {/* <details>의 콘텐츠 영역 */}
          <div className="px-8 pb-8">
            <div className="rounded bg-gray-100 p-4">
              <p>주문 상품 상세 내역이 여기에 표시됩니다.</p>
            </div>
          </div>
        </details>

        {/* 4. 주문 상세보기 버튼 */}
        <div className="p-8">
          <button
            type="button"
            className="flex h-[60px] w-full items-center justify-center rounded-[5px] bg-[#fff7e5] text-center text-[19px] font-bold text-[#ffa500] transition-colors hover:bg-[#ffedcc]"
          >
            주문 상세보기
          </button>
        </div>
      </div>
    </section>
  )
}

/**
 * 헬퍼 컴포넌트: 리뷰 작성 유도 카드
 */
function ReviewPromptCard() {
  const { rating, handleRatingChange } = useRating(0)
  return (
    <section className="w-[816px] rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white">
      <div className="flex flex-col items-center gap-6 py-10">
        <h2 className="text-lg font-bold text-black">
          구매 경험이 만족스러웠나요?
        </h2>
        <Rating rating={rating} onChange={handleRatingChange} />
      </div>
    </section>
  )
}

export default function CheckoutSuccessPage() {
  return (
    // <main> 태그: 페이지의 핵심 콘텐츠 영역
    // `absolute` 레이아웃을 제거하고 `flex` 흐름으로 변경

    <main className="flex min-h-screen w-full flex-col items-center gap-[41px] bg-[#f8f8f8] pb-20">
      {/* 헤더 컴포넌트 (시맨틱) */}
      <CheckoutHeader title="주문/결제" />

      {/* <h1> 태그: 페이지의 유일하고 가장 중요한 제목 */}
      <h1 className="text-center text-2xl font-bold text-black">
        <span className="text-[#ffa500]">주문완료</span> 되었습니다.
      </h1>

      {/* 주문 요약 카드 (시맨틱) */}
      <OrderSummaryCard />

      {/* 리뷰 유도 카드 (시맨틱) */}
      <ReviewPromptCard />
    </main>
  )
}
