"use client"

import CheckoutHeader from "@/app/[countryCode]/(checkout)/checkout/checkout-header"
import { ChevronDownIcon, ReviewPromptCard } from "./_components"

export default function CheckoutSuccessPage() {
  return (
    <main className="flex min-h-screen w-full flex-col items-center gap-6 bg-[#f8f8f8] pb-12 sm:gap-[41px] sm:pb-20">
      <CheckoutHeader title="주문/결제" />

      <h1 className="text-center text-xl font-bold text-black sm:text-2xl">
        <span className="text-[#ffa500]">주문완료</span> 되었습니다.
      </h1>

      {/* 주문 요약 카드 */}
      <OrderSummaryCard />

      {/* 리뷰 유도 카드 */}
      <ReviewPromptCard />
    </main>
  )
}

function OrderSummaryCard() {
  return (
    <section className="w-full max-w-[816px] overflow-hidden rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white">
      <div className="flex flex-col divide-y-[0.5px] divide-[#d9d9d9]">
        {/* 주문번호 */}
        <header className="flex items-center justify-between px-4 pt-6 pb-4 sm:px-8 sm:pt-8 sm:pb-6">
          <h2 className="text-base text-black sm:text-lg">
            <span className="font-bold">주문번호 </span>
            <span>20253934092938</span>
          </h2>
        </header>

        {/* 배송 정보 */}
        <div className="px-4 py-4 sm:px-8 sm:py-6">
          <dl>
            <div className="flex items-center justify-between gap-2">
              <dt className="sr-only">수령인</dt>
              <dd className="text-base font-bold text-black sm:text-lg">
                이연정 (이연정)
              </dd>
              <dd className="shrink-0">
                <button
                  type="button"
                  className="rounded-[3px] border border-[#aeaeb2] bg-white px-2 py-1 text-center text-xs font-medium text-[#1e1e1e] sm:px-2.5 sm:py-1.5 sm:text-[13px]"
                >
                  변경
                </button>
              </dd>
            </div>
            <div className="mt-3 sm:mt-4">
              <dt className="sr-only">연락처</dt>
              <dd className="text-sm text-black sm:text-base">010-0000-0000</dd>
            </div>
            <div className="mt-2">
              <dt className="sr-only">배송 주소</dt>
              <dd className="text-sm text-black sm:text-base">
                서울특별시 강북구 도봉로 89길 27(수유동) 4층
              </dd>
            </div>
          </dl>
        </div>

        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between p-4 sm:p-8">
            <div className="flex items-center gap-3 sm:gap-6">
              <img
                className="h-16 w-16 rounded-[5px] object-cover sm:h-[99px] sm:w-[99px]"
                src="affd16fd5264cab9197da4cd1a996f820e601ee4-2.png"
                alt="주문 상품 대표 이미지"
              />
              <p className="text-base text-black sm:text-lg">주문상품 1건</p>
            </div>
            <ChevronDownIcon className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-4 sm:px-8 sm:pb-8">
            <div className="rounded bg-gray-100 p-3 sm:p-4">
              <p className="text-sm sm:text-base">
                주문 상품 상세 내역이 여기에 표시됩니다.
              </p>
            </div>
          </div>
        </details>

        <div className="p-4 sm:p-8">
          <button
            type="button"
            className="flex h-12 w-full items-center justify-center rounded-[5px] bg-[#fff7e5] text-center text-base font-bold text-[#ffa500] transition-colors hover:bg-[#ffedcc] sm:h-[60px] sm:text-[19px]"
          >
            주문 상세보기
          </button>
        </div>
      </div>
    </section>
  )
}
