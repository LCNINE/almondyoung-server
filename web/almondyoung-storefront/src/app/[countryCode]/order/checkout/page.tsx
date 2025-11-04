"use client"
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

export default function CheckoutPage() {
  const router = useRouter()
  const [selectedCoupon, setSelectedCoupon] = useState("")
  const [pointsToUse, setPointsToUse] = useState("0")
  const [deliveryMemo, setDeliveryMemo] = useState("")
  const [cashReceipt, setCashReceipt] = useState("신청함")
  const [paymentMethod, setPaymentMethod] = useState("나중결제")
  const [isPaymentDetailsOpen, setIsPaymentDetailsOpen] = useState(true)
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("나중결제")
  const [cashReceiptOption, setCashReceiptOption] = useState("apply")
  const [taxInvoiceOption, setTaxInvoiceOption] = useState("noapply")

  return (
    <main className="bg-muted min-h-screen w-full">
      {/* PC 헤더 - 데스크톱에서만 표시 */}
      <div className="hidden w-full border-b border-gray-200 bg-white md:block">
        <div className="relative container mx-auto flex max-w-[1360px] items-center justify-between px-[40px] py-5">
          <Link href="/" className="flex-shrink-0">
            <img
              src="/images/almond-logo-blakc 3.png"
              alt="아몬드영"
              className="h-7"
            />
          </Link>
          <h1 className="absolute left-1/2 -translate-x-1/2 transform text-2xl font-bold">
            주문/결제
          </h1>
          <div className="w-[200px] flex-shrink-0"></div>
        </div>

        {/* 진행 상태바 */}
        <div className="container mx-auto max-w-[1360px] px-4 py-3 md:px-[40px]">
          <div className="flex items-center justify-end gap-2">
            <span className="font-bold text-gray-900">주문/결제</span>
            <svg
              className="h-6 w-6 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
            <span className="text-gray-500">완료</span>
          </div>
        </div>
      </div>

      {/* 메인 컨텐츠 - 반응형 컨테이너 */}
      <div className="md:py-8mx-auto container mx-auto max-w-[1360px] md:px-[40px] px-4">
        {/* 모바일 헤더 - 모바일에서만 표시 */}
        <header className="mb-6 flex items-center justify-between pt-6 md:hidden">
          <h1 className="text-lg font-bold text-gray-900">주문서 작성</h1>
          <button aria-label="닫기" className="text-xl text-gray-500" onClick={() => router.back()}>
            ✕
          </button>
        </header>
        <div className="md:flex md:w-full md:justify-between md:gap-9">
          {/* 왼쪽 섹션 (배송지, 주문상품, 할인정보) */}
          <div className="md:max-w-[820px] md:min-w-[420px] md:flex-1">
            {/* 배송지 */}
            <section aria-labelledby="shipping-heading" className="mb-8">
              <h2
                id="shipping-heading"
                className="mb-3 text-base font-bold text-gray-900 md:text-xl"
              >
                배송지
              </h2>
              <div className="rounded-md border border-gray-200 bg-white px-[14px] py-[18px] md:rounded-[10px] md:px-10 md:py-8">
                <div className="flex justify-between md:w-full">
                  <div className="flex-1">
                    <p className="mb-3 flex flex-col gap-2 text-[15px] font-semibold text-gray-900 md:flex-row md:items-center md:text-lg">
                      <span>이연정 (이연정)</span>
                      <span className="hidden rounded bg-[#e8f6ea] px-2 py-[2px] text-[11px] font-semibold text-[#2ba24c] md:inline">
                        기본 배송지
                      </span>
                    </p>
                    <p className="mt-1 text-[13px] text-gray-700 md:text-base">
                      010-0000-0000
                    </p>
                    <address className="text-[13px] leading-5 text-gray-700 not-italic md:text-base">
                      서울특별시 강북구 도봉로 89길 27(수유동) 4층
                    </address>

                    {/* PC에서 체크박스 */}
                    <div className="mt-4 hidden items-center gap-2 md:flex">
                      <input
                        type="checkbox"
                        id="defaultAddress"
                        className="h-[13px] w-[13px] border-gray-900"
                      />
                      <label
                        htmlFor="defaultAddress"
                        className="text-base text-gray-900"
                      >
                        기본 배송지로 저장
                      </label>
                    </div>
                  </div>
                  <button className="h-fit rounded border border-gray-300 px-3 py-1 text-[12px] font-medium text-gray-700 md:rounded-[3px] md:px-2.5 md:py-[5px] md:text-[13px]">
                    변경
                  </button>
                </div>
                <div className="mt-3">
                  <label htmlFor="memo" className="sr-only">
                    배송메모
                  </label>
                  <select
                    id="memo"
                    className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-700 md:rounded-[5px] md:px-4 md:py-3.5 md:text-sm"
                    defaultValue=""
                  >
                    <option value="" disabled>
                      배송메모를 선택해주세요
                    </option>
                  </select>
                </div>
              </div>
            </section>

            {/* 주문상품 */}
            <section aria-labelledby="order-heading" className="mb-8">
              <h2
                id="order-heading"
                className="mb-3 text-base font-bold text-gray-900 md:text-xl"
              >
                주문 상품
              </h2>

              {/* 외곽 카드 */}
              <article className="rounded-md border border-gray-200 bg-white p-4 md:rounded-[10px] md:p-10">
                {/* 상단: 썸네일 + 상품명 */}
                <div className="flex items-start gap-3 md:gap-8">
                  <img
                    src="/images/product-thumb.png"
                    alt="루가래쉬 플랫모"
                    className="h-[64px] w-[64px] rounded object-cover md:h-[99px] md:w-[99px] md:rounded-[5px]"
                  />
                  <p className="flex-1 text-[14px] font-semibold text-gray-900 md:text-base md:font-normal">
                    루가래쉬 플랫모
                  </p>
                </div>

                {/* 옵션 리스트 */}
                <div className="mt-3 space-y-2 md:mt-6 md:space-y-3">
                  <div className="flex items-start justify-between rounded bg-muted pt-[5.5px] pr-3 pb-[11px] pl-2 lg:rounded-[2px] lg:pt-2.5 lg:pr-4 lg:pb-4 lg:pl-3">
                    <div className="flex items-center gap-2 md:gap-4">
                      <span className="rounded-[2px] border border-gray-300 px-1 py-0.5 text-[12px] font-medium text-gray-600 lg:text-[11px]">
                        옵션
                      </span>
                      <span className="text-[12px] text-gray-700 md:text-base">
                        C / 0.10 / 7mm | 1개
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="mr-2 text-[12px] text-gray-400 line-through md:text-sm">
                        30,000
                      </span>
                      <span className="text-[13px] font-semibold text-gray-900 md:text-base md:font-normal">
                        9,000원
                      </span>
                    </div>
                  </div>
                </div>

                {/* 배송비 */}
                <p className="mt-3 text-right text-[12px] text-gray-600 md:mt-4 md:text-base">
                  배송비 2,500원
                </p>
              </article>
            </section>

            {/* 할인 / 부가결제 */}
            <section aria-labelledby="discount-heading" className="mb-8">
              <h2
                id="discount-heading"
                className="mb-3 text-base font-bold text-gray-900 md:text-xl"
              >
                할인 / 부가결제
              </h2>

              <div className="space-y-4 rounded-md border border-gray-200 bg-white p-4 md:space-y-0 md:rounded-[10px] md:p-8">
                {/* 자동할인 */}
                <div className="lg:mb-6">
                  <div className="mb-6 flex justify-between text-[13px] text-gray-700 md:text-base">
                    <span className="font-medium md:font-normal">자동할인</span>
                    <span className="font-medium text-red-500 md:font-normal md:text-gray-900">
                      -42,000원
                    </span>
                  </div>
                  <ul className="mt-2 mb-7 space-y-1 md:space-y-2">
                    <li className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg text-[#ff9f00] md:hidden">
                          🌻
                        </span>
                        <span className="hidden h-4 w-4 rounded-full bg-[#E08F00] md:inline"></span>
                        <span className="text-[13px] text-[#ff9f00] md:text-sm md:text-gray-700">
                          멤버십 할인
                        </span>
                      </div>
                      <span className="text-[13px] text-gray-900 md:text-sm md:text-gray-700">
                        21,000원
                      </span>
                    </li>
                    <li className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-lg text-[#ff9f00] md:hidden">
                          🌻
                        </span>
                        <span className="hidden h-4 w-4 rounded-full bg-[#E08F00] md:inline"></span>
                        <span className="text-[13px] text-[#ff9f00] md:text-sm md:text-gray-700">
                          멤버십 할인
                        </span>
                      </div>
                      <span className="text-[13px] text-gray-900 md:text-sm md:text-gray-700">
                        21,000원
                      </span>
                    </li>
                  </ul>
                </div>

                {/* 구분선 */}
                <hr className="border-gray-200" />

                {/* 쿠폰 */}
                <div className="md:pt-6 md:pb-6">
                  <label
                    htmlFor="coupon"
                    className="mb-1 block text-[13px] font-medium text-gray-900 md:mb-3 md:text-base md:font-normal"
                  >
                    쿠폰
                  </label>
                  <select
                    id="coupon"
                    className="w-full rounded border border-gray-300 px-3 py-2 text-[13px] text-gray-700 md:rounded-[5px] md:py-3 md:text-sm"
                  >
                    <option>쿠폰을 선택해주세요 (1)</option>
                  </select>
                </div>

                {/* 구분선 */}
                <hr className="border-gray-200" />

                {/* 적립금 */}
                <div className="md:pt-6">
                  <div className="mb-1 flex items-center justify-between text-[13px] md:mb-3 md:text-base">
                    <span className="font-medium md:font-normal">적립금</span>
                    <span className="font-medium text-gray-900 md:font-normal">
                      9,000원
                    </span>
                  </div>
                  <div className="md:hidden">
                    <p className="text-[12px] text-gray-500">사용가능</p>
                  </div>
                  <div className="mt-2 flex gap-2 md:gap-3">
                    <input
                      type="text"
                      defaultValue="0원"
                      className="flex-1 rounded border border-gray-300 px-3 py-2 text-[13px] font-semibold text-[#ff9f00] md:rounded-[5px] md:py-3 md:text-sm md:font-bold md:text-[#F29219]"
                    />
                    <button
                      type="button"
                      className="rounded bg-[#fff8e6] px-4 py-2 text-[13px] font-semibold text-[#ff9f00] md:rounded-[5px] md:bg-[#FFF7E5] md:px-5 md:py-3 md:text-base md:font-bold md:text-gray-900"
                    >
                      전액사용
                    </button>
                  </div>
                  <p className="mt-3 hidden items-center justify-between text-sm md:flex">
                    <span className="text-gray-700">사용</span>
                    <span className="font-bold text-[#F29219]">0원</span>
                  </p>
                </div>
              </div>
            </section>

            {/* 결제 정보 섹션 - 모든 화면에서 표시 */}
            <div>
              {/* 결제 정보 */}
              <section className="mb-8">
                <h2 className="mb-3 text-xl font-bold text-gray-900 md:text-xl">
                  결제 정보
                </h2>
                <div className="rounded-[10px] border border-gray-200 bg-white p-4 md:p-8">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-base text-gray-900">주문 상품</span>
                      <span className="text-base text-gray-900">60,000원</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-base text-gray-900">배송비</span>
                      <span className="text-base text-gray-900">2,500원</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-base text-gray-900">
                          할인 / 부가결제
                        </span>
                        <span className="rounded bg-[#E08F00] px-2 py-0.5 text-[11px] text-white">
                          멤버십 할인
                        </span>
                      </div>
                      <span className="text-base text-gray-900">
                        - 42,000원
                      </span>
                    </div>
                  </div>
                  <div className="bg-opacity-50 -mx-8 mt-6 -mb-8 flex items-center justify-between rounded-b-[10px] bg-[#FFF7E5] px-9 py-5">
                    <span className="text-lg font-bold text-gray-900">
                      총 주문 금액
                    </span>
                    <span className="text-lg font-bold text-[#F29219]">
                      20,500원
                    </span>
                  </div>
                </div>
              </section>

              {/* 결제 수단 */}
              <section className="mb-8">
                <h2 className="mb-3 text-xl font-bold text-gray-900">
                  결제 수단
                </h2>
                <div className="rounded-[10px] border border-gray-200 bg-white p-4 md:p-8">
                  <fieldset>
                    <legend className="sr-only">결제 수단 선택</legend>

                    {/* 나중결제 */}
                    <div className="relative">
                      <input
                        type="radio"
                        name="payment-method"
                        id="later-payment"
                        className="peer sr-only"
                        checked={selectedPaymentMethod === "나중결제"}
                        onChange={() => setSelectedPaymentMethod("나중결제")}
                      />
                      <label
                        htmlFor="later-payment"
                        className="block cursor-pointer"
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 ${selectedPaymentMethod === "나중결제" ? "border-[#F77F00] bg-[#F77F00]" : "border-gray-300"}`}
                          >
                            {selectedPaymentMethod === "나중결제" && (
                              <div className="flex h-full w-full items-center justify-center">
                                <div className="h-1.5 w-1.5 rounded-full bg-white"></div>
                              </div>
                            )}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-gray-800">
                              나중 결제
                              <span className="ml-1 inline-flex items-center rounded-sm bg-[#FFF8F2] px-1.5 py-0.5 text-[11px] font-bold text-[#F79A3A]">
                                멤버십
                              </span>
                              <span className="ml-1.5 font-bold text-[#F79A3A]">
                                1.5% 적립
                              </span>
                            </p>
                            <div className="mt-3 flex items-center gap-1 rounded-md bg-[#FFF8F2] p-3 text-xs text-gray-700">
                              <span>👍</span>
                              <span>
                                나중결제 등록하고
                                <span className="font-bold text-[#F79A3A]">
                                  {" "}
                                  307원{" "}
                                </span>
                                더 받기
                              </span>
                            </div>
                          </div>
                        </div>
                      </label>
                    </div>

                    <hr className="my-5 border-muted" />

                    {/* 카드결제 */}
                    <div className="relative">
                      <input
                        type="radio"
                        name="payment-method"
                        id="card-payment"
                        className="peer sr-only"
                        checked={selectedPaymentMethod === "카드결제"}
                        onChange={() => setSelectedPaymentMethod("카드결제")}
                      />
                      <label
                        htmlFor="card-payment"
                        className="block cursor-pointer"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-5 w-5 shrink-0 rounded-full border-2 ${selectedPaymentMethod === "카드결제" ? "border-[#F77F00] bg-[#F77F00]" : "border-gray-300"}`}
                          >
                            {selectedPaymentMethod === "카드결제" && (
                              <div className="flex h-full w-full items-center justify-center">
                                <div className="h-1.5 w-1.5 rounded-full bg-white"></div>
                              </div>
                            )}
                          </div>
                          <img
                            src="https://via.placeholder.com/56x56/111827/111827"
                            alt="카드 로고"
                            className="h-14 w-14 rounded-lg bg-gray-900"
                          />
                          <div>
                            <p className="text-sm font-semibold text-gray-800">
                              현대카드
                            </p>
                            <p className="text-xs text-gray-500">
                              100*-****-****-3434
                            </p>
                          </div>
                        </div>
                      </label>
                    </div>

                    <hr className="my-5 border-muted" />

                    {/* 일반결제 */}
                    <div className="relative">
                      <input
                        type="radio"
                        name="payment-method"
                        id="general-payment"
                        className="peer sr-only"
                        checked={selectedPaymentMethod === "일반결제"}
                        onChange={() => setSelectedPaymentMethod("일반결제")}
                      />
                      <label
                        htmlFor="general-payment"
                        className="flex cursor-pointer items-center gap-3"
                      >
                        <div
                          className={`h-5 w-5 shrink-0 rounded-full border-2 ${selectedPaymentMethod === "일반결제" ? "border-[#F77F00] bg-[#F77F00]" : "border-gray-300"}`}
                        >
                          {selectedPaymentMethod === "일반결제" && (
                            <div className="flex h-full w-full items-center justify-center">
                              <div className="h-1.5 w-1.5 rounded-full bg-white"></div>
                            </div>
                          )}
                        </div>
                        <span className="text-sm font-semibold text-gray-800">
                          일반결제 (토스결제)
                        </span>
                      </label>
                    </div>
                  </fieldset>
                </div>
              </section>

              {/* 현금영수증/세금계산서 */}
              <section className="mb-8">
                <h2 className="mb-3 text-xl font-bold text-gray-900">
                  현금영수증 / 세금계산서
                </h2>
                <ReceiptOptions
                  cashReceiptOption={cashReceiptOption}
                  setCashReceiptOption={setCashReceiptOption}
                  taxInvoiceOption={taxInvoiceOption}
                  setTaxInvoiceOption={setTaxInvoiceOption}
                />
              </section>
            </div>
          </div>

          {/* 오른쪽 섹션 (PC: 결제 상세 / 모바일: 주문 요약) */}
          <div className="md:flex-shrink-0">
            {/* 모바일: 주문 요약 정보 */}
            <section
              aria-labelledby="order-summary-heading"
              className="mb-6 md:hidden"
            >
              <h2
                id="order-summary-heading"
                className="mb-4 text-lg font-bold text-gray-800"
              >
                주문 요약
              </h2>
              <div className="overflow-hidden rounded-lg bg-white">
                <dl>
                  <div className="flex justify-between px-5 py-4">
                    <dt className="text-sm text-gray-600">주문 상품</dt>
                    <dd className="text-sm font-semibold text-gray-800">
                      60,000원
                    </dd>
                  </div>
                  <div className="flex justify-between px-5 py-4">
                    <dt className="text-sm text-gray-600">배송비</dt>
                    <dd className="text-sm font-semibold text-gray-800">
                      2,500원
                    </dd>
                  </div>
                  <div className="flex items-center justify-between px-5 py-4">
                    <dt className="flex items-center gap-1.5 text-sm text-gray-600">
                      할인 / 부가결제
                      <span className="inline-flex items-center rounded-sm bg-[#FFF8F2] px-1.5 py-0.5 text-[11px] font-bold text-[#F79A3A]">
                        멤버십 할인
                      </span>
                    </dt>
                    <dd className="text-sm font-semibold text-gray-800">
                      - 42,000원
                    </dd>
                  </div>
                </dl>
                <div className="flex items-center justify-between bg-[#FFFBF2] px-5 py-4">
                  <p className="text-base font-bold text-gray-800">
                    총 주문 금액
                  </p>
                  <p className="text-xl font-extrabold text-[#F77F00]">
                    20,500원
                  </p>
                </div>
              </div>
            </section>

            {/* PC: 결제 상세 */}
            <section className="hidden md:block md:min-w-[320px] md:flex-1 lg:w-[412px]">
              <div className="flex items-center justify-between">
                <h2 className="mb-3 text-xl font-bold text-gray-900">
                  결제 상세
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-[#F29219]">
                    20,500원
                  </span>
                  <button
                    onClick={() =>
                      setIsPaymentDetailsOpen(!isPaymentDetailsOpen)
                    }
                    className="rounded p-1 hover:bg-muted"
                  >
                    <svg
                      className={`h-6 w-6 transition-transform duration-200 ${isPaymentDetailsOpen ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2.5}
                        d="M5 15l7-7 7 7"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              {isPaymentDetailsOpen && (
                <div className="rounded-[10px] border border-gray-200 bg-white">
                  <div className="p-7">
                    <div className="mb-10 flex items-center justify-between">
                      <span className="text-lg font-bold text-gray-900">
                        나중결제
                      </span>
                      <span className="text-lg font-bold text-gray-900">
                        20,500원
                      </span>
                    </div>
                    <hr className="-mx-7 mb-4 border-gray-200" />
                    <div className="space-y-2 text-base text-gray-900">
                      <p>사용중: 150,000원 / 한도: 800,000원</p>
                      <p>다음 결제일: 2024.02.25 (D-5)</p>
                    </div>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* PC 하단 고정 영역 */}
      <div className="fixed right-0 bottom-0 left-0 hidden bg-white shadow-[0px_-6px_18px_-2px_rgba(0,0,0,0.25)] md:block">
        <div className="container mx-auto max-w-[1360px] px-[40px] py-4">
          <div className="flex items-center justify-between">
            <p className="text-base text-gray-600">
              약관 및 주문 내용을 확인하였으며, 정보 제공 등에 동의합니다.
            </p>
            <button
              onClick={() => {
                // 결제 처리 로직 (실제로는 API 호출)
                console.log("결제 처리:", {
                  paymentMethod: selectedPaymentMethod,
                  cashReceipt: cashReceiptOption,
                  taxInvoice: taxInvoiceOption,
                  amount: 20500,
                })
                // 주문완료 페이지로 이동
                window.location.href = "/order/complete"
              }}
              className="min-w-[403px] rounded-[5px] bg-[#F29219] px-4 py-[14px] text-[19px] font-bold text-white"
            >
              20,500원 결제하기
            </button>
          </div>
        </div>
      </div>

      {/* 모바일 CTA */}
      <footer className="mt-6 px-4 pb-6 md:hidden">
        <p className="mb-2 text-center text-[11px] text-gray-600">
          주문 내용을 확인하였으며, 정보 제공에 동의합니다.
        </p>
        <button
          onClick={() => {
            // 결제 처리 로직 (실제로는 API 호출)
            console.log("결제 처리:", {
              paymentMethod: selectedPaymentMethod,
              cashReceipt: cashReceiptOption,
              taxInvoice: taxInvoiceOption,
              amount: 20500,
            })
            // 주문완료 페이지로 이동
            window.location.href = "/order/complete"
          }}
          className="w-full rounded bg-[#ff9f00] py-3 text-[15px] font-semibold text-white"
        >
          결제하기
        </button>
      </footer>
    </main>
  )
}

// 현금영수증/세금계산서 컴포넌트
function ReceiptOptions({
  cashReceiptOption,
  setCashReceiptOption,
  taxInvoiceOption,
  setTaxInvoiceOption,
}: {
  cashReceiptOption: string
  setCashReceiptOption: (value: string) => void
  taxInvoiceOption: string
  setTaxInvoiceOption: (value: string) => void
}) {
  // 커스텀 라디오 버튼을 위한 공통 스타일
  const CustomRadio = ({
    label,
    name,
    value,
    checked,
    onChange,
  }: {
    label: string
    name: string
    value: string
    checked: boolean
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  }) => (
    <label className="flex cursor-pointer items-center space-x-2">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="peer sr-only" // 실제 라디오 버튼은 숨깁니다.
      />
      {/* 커스텀 원형 버튼 */}
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${checked ? "border-orange-500" : "border-gray-300"}`}
      >
        {/* 선택 시 내부 주황색 점 */}
        {checked && (
          <span className="h-2.5 w-2.5 rounded-full bg-orange-500"></span>
        )}
      </span>
      <span
        className={`text-sm ${checked ? "font-semibold text-gray-800" : "text-gray-500"}`}
      >
        {label}
      </span>
    </label>
  )

  return (
    <div className="w-full space-y-4 rounded-lg bg-transparent py-4 md:space-y-6">
      {/* 현금영수증 섹션 */}
      <div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-0">
          <h3 className="text-base font-bold">현금영수증</h3>
          <div className="flex items-center space-x-4">
            <CustomRadio
              label="신청함"
              name="cashReceipt"
              value="apply"
              checked={cashReceiptOption === "apply"}
              onChange={(e) => setCashReceiptOption(e.target.value)}
            />
            <CustomRadio
              label="신청안함"
              name="cashReceipt"
              value="noapply"
              checked={cashReceiptOption === "noapply"}
              onChange={(e) => setCashReceiptOption(e.target.value)}
            />
          </div>
        </div>
        {cashReceiptOption === "apply" && (
          <div className="mt-3 rounded-lg bg-[#fff] p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-800">사업자</p>
                <p className="mt-1 text-sm text-gray-500">
                  바나뷰티 010-101010-1020
                </p>
              </div>
              <button className="w-fit rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">
                변경
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 세금계산서 섹션 */}
      <div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-0">
          <h3 className="text-base font-bold">세금계산서</h3>
          <div className="flex items-center space-x-4">
            <CustomRadio
              label="신청함"
              name="taxInvoice"
              value="apply"
              checked={taxInvoiceOption === "apply"}
              onChange={(e) => setTaxInvoiceOption(e.target.value)}
            />
            <CustomRadio
              label="신청안함"
              name="taxInvoice"
              value="noapply"
              checked={taxInvoiceOption === "noapply"}
              onChange={(e) => setTaxInvoiceOption(e.target.value)}
            />
          </div>
        </div>
        {taxInvoiceOption === "apply" && (
          <div className="mt-3 rounded-lg bg-[#fff] p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-800">사업자</p>
                <p className="mt-1 text-sm text-gray-500">
                  바나뷰티 010-101010-1020
                </p>
              </div>
              <button className="w-fit rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">
                변경
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
