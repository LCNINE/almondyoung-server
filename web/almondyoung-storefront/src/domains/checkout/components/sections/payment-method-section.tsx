"use client"

import Image from "next/image"

const ALMOND_LOGO_URL = "/images/almond_white_logo.svg"
const TOSS_LOGO_URL = "/images/toss-payment-logo.jpg"

// 결제 수단 섹션
export const PaymentMethodSection = ({
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
        className={`hover:bg-gray-10! flex w-full cursor-pointer items-start gap-3 rounded-[10px] border p-[30px] transition-all ${
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
            className={`relative mt-2 h-44 w-72 overflow-hidden rounded-xl bg-linear-to-br from-[#2C2C2E] to-[#1C1C1E] p-6 text-white shadow-lg ${selectedMethod === "payLater" ? "opacity-100 ring-2 ring-[#F29219]/30" : "opacity-70 grayscale"} transition-all duration-300`}
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
                <div className="h-8 w-10 rounded-md bg-linear-to-br from-yellow-200 to-yellow-500 opacity-80" />
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
        className={`hover:bg-gray-10! flex w-full cursor-pointer items-center gap-3 rounded-[10px] border p-[30px] transition-all ${
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
