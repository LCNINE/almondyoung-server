"use client"
import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { ChevronDown } from "lucide-react"

const ALMOND_LOGO_URL = "/images/almond_white_logo.svg"
const TOSS_LOGO_URL = "/images/toss-payment-logo.jpg"

// 멤버십 태그 아이콘
const MembershipTagIcon = () => (
  <svg
    width={13}
    height={13}
    viewBox="0 0 13 13"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="flex-shrink-0"
  >
    <path
      d="M10.8366 9.0755C10.7135 9.05059 10.5862 9.06104 10.4684 9.10573C10.3506 9.15042 10.2467 9.22765 10.168 9.32911C10.0893 9.43058 10.0386 9.55244 10.0215 9.6816C10.0044 9.81075 10.0216 9.9423 10.071 10.0621C10.3635 10.7461 9.54681 11.3642 8.96742 10.8996C8.86871 10.819 8.75146 10.7666 8.62729 10.7477C8.50311 10.7287 8.37633 10.7438 8.2595 10.7915C8.14268 10.8392 8.03987 10.9178 7.96126 11.0195C7.88266 11.1212 7.831 11.2425 7.8114 11.3713C7.72311 12.1084 6.70779 12.2317 6.43189 11.5434C6.38233 11.4225 6.30329 11.3171 6.20257 11.2377C6.10186 11.1582 5.98295 11.1074 5.85759 11.0904C5.73223 11.0733 5.60474 11.0905 5.48773 11.1402C5.37071 11.19 5.26821 11.2707 5.19034 11.3742C4.74476 11.9693 3.7998 11.5721 3.91292 10.8379C3.92848 10.7094 3.91109 10.579 3.86251 10.4598C3.81393 10.3406 3.73589 10.2368 3.63631 10.1591C3.53673 10.0813 3.41913 10.0323 3.29546 10.0171C3.17179 10.0018 3.04643 10.0208 2.93209 10.0721C2.24924 10.3589 1.62984 9.54729 2.09611 8.96795H2.10439C2.1806 8.86688 2.2293 8.7464 2.2454 8.61908C2.2615 8.49176 2.24441 8.36228 2.19592 8.24417C2.14743 8.12606 2.06931 8.02366 1.96973 7.94766C1.87015 7.87167 1.75277 7.82486 1.62984 7.81215C1.47429 7.79927 1.3277 7.7313 1.21457 7.61959C1.10143 7.50787 1.02861 7.35918 1.00826 7.19836C0.987914 7.03754 1.02128 6.87433 1.10277 6.73601C1.18427 6.59768 1.30896 6.49262 1.45602 6.43837C1.57348 6.39615 1.67747 6.32108 1.75655 6.22141C1.83563 6.12175 1.88675 6.00135 1.90429 5.87345C1.92183 5.74554 1.9051 5.61509 1.85595 5.49643C1.8068 5.37777 1.72713 5.27549 1.6257 5.20083C1.03113 4.75486 1.42843 3.81128 2.16371 3.92457C2.28701 3.95011 2.41468 3.94014 2.53293 3.89572C2.65117 3.8513 2.75549 3.77413 2.8346 3.67255C2.91371 3.57098 2.96461 3.44885 2.98179 3.31938C2.99898 3.18992 2.98179 3.05803 2.93209 2.93798C2.64101 2.25539 3.4563 1.6359 4.03569 2.10052C4.13431 2.18108 4.25145 2.23347 4.37553 2.2525C4.49961 2.27154 4.62632 2.25655 4.74311 2.20903C4.85991 2.16151 4.96274 2.0831 5.04142 1.98157C5.12011 1.88004 5.17191 1.75891 5.19172 1.63017C5.28139 0.891657 6.29532 0.769767 6.57122 1.45665C6.62079 1.57756 6.69983 1.68295 6.80054 1.7624C6.90126 1.84185 7.02016 1.89263 7.14553 1.90972C7.27089 1.9268 7.39837 1.90961 7.51538 1.85983C7.6324 1.81005 7.7349 1.72941 7.81278 1.62587C8.24456 1.03219 9.18814 1.43084 9.07502 2.16362C9.05919 2.29268 9.07664 2.42379 9.12557 2.54354C9.17451 2.66329 9.25317 2.76737 9.35352 2.84513C9.45387 2.92289 9.57229 2.97153 9.69667 2.98609C9.82104 3.00064 9.9469 2.98057 10.0614 2.92794C10.7442 2.64114 11.3636 3.45278 10.8987 4.03212C10.8197 4.13209 10.7685 4.25264 10.7508 4.3807C10.733 4.50875 10.7493 4.63942 10.7979 4.75852C10.8466 4.87763 10.9256 4.98061 11.0266 5.05631C11.1275 5.13201 11.2465 5.17753 11.3705 5.18792C11.5266 5.20034 11.6738 5.26823 11.7874 5.38019C11.901 5.49215 11.974 5.64134 11.9943 5.80269C12.0145 5.96405 11.9807 6.12772 11.8985 6.26621C11.8163 6.40469 11.6908 6.50954 11.543 6.56313C11.4255 6.6051 11.3214 6.67999 11.2423 6.77952C11.1631 6.87906 11.1119 6.99939 11.0944 7.12723C11.0768 7.25508 11.0936 7.38548 11.1428 7.50406C11.192 7.62264 11.2718 7.22478 11.3733 7.79924C11.9678 8.24521 11.5705 9.18879 10.8366 9.0755Z"
      fill="#E08F00"
    />
    <path
      d="M5.52392 8.5349L3.62158 6.39681L4.2465 5.79596L5.59565 7.3117L8.82783 4.46521L9.37825 5.14062L5.52392 8.5349Z"
      fill="white"
    />
  </svg>
)

// 커스텀 라디오 버튼
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
      className="peer sr-only"
    />
    <span
      className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${checked ? "border-[#F29219]" : "border-gray-300"}`}
    >
      {checked && (
        <span className="h-2.5 w-2.5 rounded-full bg-[#F29219]"></span>
      )}
    </span>
    <span
      className={`text-sm ${checked ? "font-semibold text-gray-800" : "text-gray-500"}`}
    >
      {label}
    </span>
  </label>
)

// PC 헤더
const PCHeader = () => (
  <div className="hidden w-full border-b border-gray-200 bg-white md:block">
    <div className="relative container mx-auto flex max-w-[1360px] items-center justify-between px-[40px] py-5">
      <Link href="/" className="flex-shrink-0">
        <img
          src="/images/almond-logo-black.png"
          alt="아몬드영"
          className="h-7"
        />
      </Link>
      <h1 className="absolute left-1/2 -translate-x-1/2 transform text-2xl font-bold">
        주문/결제
      </h1>
      <div className="w-[200px] flex-shrink-0"></div>
    </div>

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
)

// 모바일 헤더
const MobileHeader = ({ onClose }: { onClose: () => void }) => (
  <header className="mb-6 flex items-center justify-between pt-6 md:hidden">
    <h1 className="text-lg font-bold text-gray-900">주문서 작성</h1>
    <button
      aria-label="닫기"
      className="text-xl text-gray-500"
      onClick={onClose}
    >
      ✕
    </button>
  </header>
)

// 배송지 섹션
const ShippingSection = () => (
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
)

// 주문상품 섹션
const OrderProductsSection = () => (
  <section aria-labelledby="order-heading" className="mb-8">
    <h2
      id="order-heading"
      className="mb-3 text-base font-bold text-gray-900 md:text-xl"
    >
      주문 상품
    </h2>
    <article className="rounded-md border border-gray-200 bg-white p-4 md:rounded-[10px] md:p-10">
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

      <div className="mt-3 space-y-2 md:mt-6 md:space-y-3">
        <div className="bg-muted flex items-start justify-between rounded pt-[5.5px] pr-3 pb-[11px] pl-2 lg:rounded-[2px] lg:pt-2.5 lg:pr-4 lg:pb-4 lg:pl-3">
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

      <p className="mt-3 text-right text-[12px] text-gray-600 md:mt-4 md:text-base">
        배송비 2,500원
      </p>
    </article>
  </section>
)

// 할인/부가결제 섹션
const DiscountSection = () => (
  <section aria-labelledby="discount-heading" className="mb-8">
    <h2
      id="discount-heading"
      className="mb-3 text-base font-bold text-gray-900 md:text-xl"
    >
      할인 / 부가결제
    </h2>
    <div className="flex w-full flex-col gap-5 rounded-[10px] border border-[#d9d9d9] bg-white p-[15px] md:max-w-[810px] md:gap-8 md:p-[30px]">
      {/* 자동할인 */}
      <div className="flex flex-col justify-between md:flex-row md:items-center">
        <div className="flex flex-col gap-1.5 md:gap-2">
          <h3 className="text-xs font-bold text-black md:text-base">
            자동할인
          </h3>
          <div className="flex items-center gap-0.5">
            <MembershipTagIcon />
            <span className="text-[10px] font-medium text-[#e08f00] md:text-sm">
              멤버십 할인
            </span>
          </div>
        </div>
        <div className="mt-2 flex flex-col items-end gap-0.5 md:mt-0">
          <span className="text-sm font-medium text-[#757575] line-through md:text-base">
            -21,000원
          </span>
          <span className="text-base font-bold text-black md:text-lg">
            -42,000원
          </span>
        </div>
      </div>

      <hr className="border-t border-[#d9d9d9]" />

      {/* 쿠폰 */}
      <div className="flex flex-col gap-3 md:gap-4">
        <label className="text-xs font-bold text-black md:text-base">
          쿠폰
        </label>
        <div className="relative w-full">
          <select className="w-full appearance-none rounded-[5px] border border-[#d9d9d9] bg-white px-2.5 py-[9px] text-[11px] text-black placeholder:text-[#b3b3b3] focus:border-black focus:outline-none md:px-4 md:py-3 md:text-sm">
            <option value="" disabled selected>
              쿠폰을 선택해주세요 (1)
            </option>
            <option value="coupon1">5% 할인 쿠폰</option>
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 h-3 w-3 -translate-y-1/2 text-black md:h-4 md:w-4" />
        </div>
      </div>

      <hr className="border-t border-[#d9d9d9]" />

      {/* 적립금 */}
      <div className="flex flex-col gap-3 md:gap-4">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold text-black md:text-base">
            적립금
          </label>
          <span className="text-xs text-black md:text-sm">
            보유: <span className="font-bold">9,000원</span>
          </span>
        </div>
        <div className="flex gap-2 md:gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="0"
              className="w-full rounded-[5px] border border-[#d9d9d9] px-3 py-2 text-right text-[13px] font-bold text-[#ffa500] placeholder-gray-300 focus:border-[#ffa500] focus:outline-none md:px-4 md:py-3 md:text-base"
            />
            <span className="absolute top-1/2 left-3 -translate-y-1/2 text-[11px] text-[#757575] md:text-sm">
              사용
            </span>
            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-[#757575] md:text-sm">
              원
            </span>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-[5px] bg-[#fff7e5] px-3 py-2 text-[11px] font-bold text-black transition-colors hover:bg-[#ffeeb3] md:px-5 md:py-3 md:text-sm"
          >
            전액사용
          </button>
        </div>
      </div>
    </div>
  </section>
)

// 결제 정보 섹션
const PaymentInfoSection = () => (
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
            <span className="text-base text-gray-900">할인 / 부가결제</span>
            <span className="rounded bg-[#E08F00] px-2 py-0.5 text-[11px] text-white">
              멤버십 할인
            </span>
          </div>
          <span className="text-base text-gray-900">- 42,000원</span>
        </div>
      </div>
      <div className="bg-opacity-50 -mx-8 mt-6 -mb-8 flex items-center justify-between rounded-b-[10px] bg-[#FFF7E5] px-9 py-5">
        <span className="text-lg font-bold text-gray-900">총 주문 금액</span>
        <span className="text-lg font-bold text-[#F29219]">20,500원</span>
      </div>
    </div>
  </section>
)

// 결제 수단 섹션
const PaymentMethodSection = ({
  selectedMethod,
  setSelectedMethod,
}: {
  selectedMethod: string
  setSelectedMethod: (method: string) => void
}) => (
  <section className="mb-8">
    <h2 className="mb-3 text-xl font-bold text-gray-900">결제 수단</h2>
    <div className="flex w-full max-w-[810px] flex-col gap-4">
      {/* 나중 결제 */}
      <div
        role="radio"
        aria-checked={selectedMethod === "payLater"}
        tabIndex={0}
        onClick={() => setSelectedMethod("payLater")}
        className={`flex w-full cursor-pointer items-start gap-3 rounded-[10px] border p-[30px] transition-all ${
          selectedMethod === "payLater"
            ? "border-[#F29219] bg-orange-50/10 ring-1 ring-[#F29219]"
            : "border-[#d9d9d9] bg-white hover:bg-gray-50"
        }`}
      >
        <div className="mt-0.5 shrink-0">
          {selectedMethod === "payLater" ? (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#F29219]">
              <div className="h-2.5 w-2.5 rounded-full bg-white" />
            </div>
          ) : (
            <div className="h-5 w-5 rounded-full border border-[#d9d9d9] bg-white" />
          )}
        </div>

        <div className="flex flex-1 flex-col gap-4">
          <div className="flex flex-col gap-2.5">
            <h3 className="text-lg leading-none font-bold text-[#1c1c1e]">
              나중 결제
            </h3>
            <p className="text-base leading-normal text-black">
              지금 구매, 납부는 다음달에! (최대 50만원)
            </p>
          </div>

          <div
            className={`relative mt-2 h-44 w-72 overflow-hidden rounded-xl bg-gradient-to-br from-[#2C2C2E] to-[#1C1C1E] p-6 text-white shadow-lg ${selectedMethod === "payLater" ? "opacity-100 ring-2 ring-[#F29219]/30" : "opacity-70 grayscale"} transition-all duration-300`}
          >
            <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-white/5 blur-2xl" />
            <div className="absolute -bottom-8 -left-8 h-32 w-32 rounded-full bg-[#F29219]/20 blur-2xl" />

            <div className="relative z-10 flex h-full flex-col justify-between">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="relative h-8 w-8 overflow-hidden rounded-full bg-white/10 p-1">
                    <Image
                      src={ALMOND_LOGO_URL}
                      alt="Almond Young"
                      fill
                      className="object-contain p-0.5"
                    />
                  </div>
                  <span className="text-sm font-bold tracking-wide">
                    Almond Pay
                  </span>
                </div>
                <div className="h-8 w-10 rounded-md bg-gradient-to-br from-yellow-200 to-yellow-500 opacity-80" />
              </div>

              <div className="flex flex-col gap-2">
                <p className="font-mono text-xl tracking-widest text-white/90">
                  **** **** **** 1234
                </p>
                <div className="flex items-end justify-between">
                  <p className="text-xs font-medium text-white/60">MEMBER</p>
                  <p className="font-mono text-sm text-white/80">11 / 29</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 토스 결제 */}
      <div
        role="radio"
        aria-checked={selectedMethod === "toss"}
        tabIndex={0}
        onClick={() => setSelectedMethod("toss")}
        className={`flex w-full cursor-pointer items-center gap-3 rounded-[10px] border p-[30px] transition-all ${
          selectedMethod === "toss"
            ? "border-[#0064FF] bg-blue-50/10 ring-1 ring-[#0064FF]"
            : "border-[#d9d9d9] bg-white hover:bg-gray-50"
        }`}
      >
        <div className="shrink-0">
          {selectedMethod === "toss" ? (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0064FF]">
              <div className="h-2.5 w-2.5 rounded-full bg-white" />
            </div>
          ) : (
            <div className="h-5 w-5 rounded-full border border-[#d9d9d9] bg-white" />
          )}
        </div>

        <div className="flex flex-1 items-center justify-between">
          <div className="flex flex-col gap-1">
            <h3 className="text-lg leading-none font-bold text-[#1c1c1e]">
              토스 결제
            </h3>
            <p className="text-sm text-gray-500">
              토스페이로 간편하게 결제하세요.
            </p>
          </div>

          <div
            className="relative h-8 w-20 grayscale transition-all duration-300"
            style={{
              filter:
                selectedMethod === "toss"
                  ? "none"
                  : "grayscale(100%) opacity(0.5)",
            }}
          >
            <Image
              src={TOSS_LOGO_URL}
              alt="Toss Payment"
              fill
              className="object-contain object-right"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
)

// 현금영수증/세금계산서 섹션
const ReceiptSection = ({
  cashReceiptOption,
  setCashReceiptOption,
  taxInvoiceOption,
  setTaxInvoiceOption,
}: {
  cashReceiptOption: string
  setCashReceiptOption: (value: string) => void
  taxInvoiceOption: string
  setTaxInvoiceOption: (value: string) => void
}) => (
  <section className="mb-8">
    <h2 className="mb-3 text-xl font-bold text-gray-900">
      현금영수증 / 세금계산서
    </h2>
    <div className="w-full space-y-4 rounded-lg bg-transparent py-4 md:space-y-6">
      {/* 현금영수증 */}
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

      {/* 세금계산서 */}
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
  </section>
)

// PC 결제 상세 사이드바
const PaymentDetailSidebar = ({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean
  setIsOpen: (open: boolean) => void
}) => (
  <section className="hidden md:block md:min-w-[320px] md:flex-1 lg:w-[412px]">
    <div className="flex items-center justify-between">
      <h2 className="mb-3 text-xl font-bold text-gray-900">결제 상세</h2>
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold text-[#F29219]">20,500원</span>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="hover:bg-muted rounded p-1"
        >
          <svg
            className={`h-6 w-6 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
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
    {isOpen && (
      <div className="rounded-[10px] border border-gray-200 bg-white">
        <div className="p-7">
          <div className="mb-10 flex items-center justify-between">
            <span className="text-lg font-bold text-gray-900">나중결제</span>
            <span className="text-lg font-bold text-gray-900">20,500원</span>
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
)

// 모바일 주문 요약
const MobileOrderSummary = () => (
  <section aria-labelledby="order-summary-heading" className="mb-6 md:hidden">
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
          <dd className="text-sm font-semibold text-gray-800">60,000원</dd>
        </div>
        <div className="flex justify-between px-5 py-4">
          <dt className="text-sm text-gray-600">배송비</dt>
          <dd className="text-sm font-semibold text-gray-800">2,500원</dd>
        </div>
        <div className="flex items-center justify-between px-5 py-4">
          <dt className="flex items-center gap-1.5 text-sm text-gray-600">
            할인 / 부가결제
            <span className="inline-flex items-center rounded-sm bg-[#FFF8F2] px-1.5 py-0.5 text-[11px] font-bold text-[#F79A3A]">
              멤버십 할인
            </span>
          </dt>
          <dd className="text-sm font-semibold text-gray-800">- 42,000원</dd>
        </div>
      </dl>
      <div className="flex items-center justify-between bg-[#FFFBF2] px-5 py-4">
        <p className="text-base font-bold text-gray-800">총 주문 금액</p>
        <p className="text-xl font-extrabold text-[#F77F00]">20,500원</p>
      </div>
    </div>
  </section>
)

// PC 하단 고정 CTA
const PCFixedCTA = ({ onPayment }: { onPayment: () => void }) => (
  <div className="fixed right-0 bottom-0 left-0 hidden bg-white shadow-[0px_-6px_18px_-2px_rgba(0,0,0,0.25)] md:block">
    <div className="container mx-auto max-w-[1360px] px-[40px] py-4">
      <div className="flex items-center justify-between">
        <p className="text-base text-gray-600">
          약관 및 주문 내용을 확인하였으며, 정보 제공 등에 동의합니다.
        </p>
        <button
          onClick={onPayment}
          className="min-w-[403px] rounded-[5px] bg-[#F29219] px-4 py-[14px] text-[19px] font-bold text-white"
        >
          20,500원 결제하기
        </button>
      </div>
    </div>
  </div>
)

// 모바일 CTA
const MobileCTA = ({ onPayment }: { onPayment: () => void }) => (
  <footer className="mt-6 px-4 pb-6 md:hidden">
    <p className="mb-2 text-center text-[11px] text-gray-600">
      주문 내용을 확인하였으며, 정보 제공에 동의합니다.
    </p>
    <button
      onClick={onPayment}
      className="w-full rounded bg-[#ff9f00] py-3 text-[15px] font-semibold text-white"
    >
      결제하기
    </button>
  </footer>
)

// 메인 컴포넌트
export default function CheckoutPage() {
  const router = useRouter()
  const [selectedMethod, setSelectedMethod] = useState("payLater")
  const [cashReceiptOption, setCashReceiptOption] = useState("noapply")
  const [taxInvoiceOption, setTaxInvoiceOption] = useState("noapply")
  const [isPaymentDetailsOpen, setIsPaymentDetailsOpen] = useState(true)

  const handlePayment = () => {
    console.log("결제 처리:", {
      paymentMethod: selectedMethod,
      cashReceipt: cashReceiptOption,
      taxInvoice: taxInvoiceOption,
      amount: 20500,
    })
    window.location.href = "/success"
  }

  return (
    <main className="bg-muted min-h-screen w-full">
      <PCHeader />

      <div className="md:py-8mx-auto container mx-auto max-w-[1360px] px-4 md:px-[40px]">
        <MobileHeader onClose={() => router.back()} />

        <div className="md:flex md:w-full md:justify-between md:gap-9">
          {/* 왼쪽 섹션 */}
          <div className="md:max-w-[820px] md:min-w-[420px] md:flex-1">
            <ShippingSection />
            <OrderProductsSection />
            <DiscountSection />
            <PaymentInfoSection />
            <PaymentMethodSection
              selectedMethod={selectedMethod}
              setSelectedMethod={setSelectedMethod}
            />
            <ReceiptSection
              cashReceiptOption={cashReceiptOption}
              setCashReceiptOption={setCashReceiptOption}
              taxInvoiceOption={taxInvoiceOption}
              setTaxInvoiceOption={setTaxInvoiceOption}
            />
          </div>

          {/* 오른쪽 섹션 */}
          <div className="md:flex-shrink-0">
            <MobileOrderSummary />
            <PaymentDetailSidebar
              isOpen={isPaymentDetailsOpen}
              setIsOpen={setIsPaymentDetailsOpen}
            />
          </div>
        </div>
      </div>

      <PCFixedCTA onPayment={handlePayment} />
      <MobileCTA onPayment={handlePayment} />
    </main>
  )
}
