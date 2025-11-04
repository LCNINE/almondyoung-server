"use client"
import { useState } from "react"

// 결제 페이지 - 결제수단 선택 및 최종 결제
export default function PaymentPage() {
  return (
    <main className="min-h-screen bg-[#f8f8f8]">
      {/* 컨테이너: 공통 패딩·폭 */}
      <div className="container mx-auto max-w-[480px] px-4 py-6">
        {/* 헤더 */}
        <header className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button aria-label="이전 페이지" className="text-xl text-gray-500">
              ←
            </button>
            <h1 className="text-lg font-bold text-gray-900">결제</h1>
          </div>
          <button aria-label="닫기" className="text-xl text-gray-500">
            ✕
          </button>
        </header>

        {/* 최종 결제정보 요약 */}
        <section aria-labelledby="final-payment-info-heading" className="mb-6">
          <h2
            id="final-payment-info-heading"
            className="mb-4 text-lg font-bold text-gray-800"
          >
            결제 정보
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
                <dd className="text-sm font-semibold text-gray-800">2,500원</dd>
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
              <p className="text-base font-bold text-gray-800">총 결제 금액</p>
              <p className="text-xl font-extrabold text-[#F77F00]">20,500원</p>
            </div>
          </div>
        </section>

        {/* 결제수단 */}
        <section aria-labelledby="payment-method-heading" className="mb-8">
          <h2
            id="payment-method-heading"
            className="mb-4 text-lg font-bold text-gray-800"
          >
            결제 수단
          </h2>
          <fieldset className="rounded-lg bg-white p-5">
            <legend className="sr-only">결제 수단 선택</legend>

            {/* 나중결제 */}
            <div className="relative">
              <input
                type="radio"
                name="payment-method"
                id="later-payment"
                className="peer sr-only"
                defaultChecked
              />
              <label htmlFor="later-payment" className="block cursor-pointer">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-gray-300 peer-checked:border-[#F77F00] peer-checked:bg-[#F77F00] peer-checked:[&_div]:block">
                    <div className="hidden h-full w-full items-center justify-center text-white">
                      <div className="h-1.5 w-1.5 rounded-full bg-white"></div>
                    </div>
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

            <hr className="my-5 border-border-muted" />

            {/* 카드결제 */}
            <div className="relative">
              <input
                type="radio"
                name="payment-method"
                id="card-payment"
                className="peer sr-only"
              />
              <label htmlFor="card-payment" className="block cursor-pointer">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 shrink-0 rounded-full border border-gray-300 peer-checked:border-[#F77F00] peer-checked:bg-[#F77F00] peer-checked:[&_div]:block">
                    <div className="hidden h-full w-full items-center justify-center">
                      <div className="h-1.5 w-1.5 rounded-full bg-white"></div>
                    </div>
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
                    <p className="text-xs text-gray-500">100*-****-****-3434</p>
                  </div>
                </div>
              </label>
            </div>

            <hr className="my-5 border-border-muted" />

            {/* 일반결제 */}
            <div className="relative">
              <input
                type="radio"
                name="payment-method"
                id="general-payment"
                className="peer sr-only"
              />
              <label
                htmlFor="general-payment"
                className="flex cursor-pointer items-center gap-3"
              >
                <div className="h-5 w-5 shrink-0 rounded-full border border-gray-300 peer-checked:border-[#F77F00] peer-checked:bg-[#F77F00] peer-checked:[&_div]:block">
                  <div className="hidden h-full w-full items-center justify-center">
                    <div className="h-1.5 w-1.5 rounded-full bg-white"></div>
                  </div>
                </div>
                <span className="text-sm font-semibold text-gray-800">
                  일반결제
                </span>
              </label>
            </div>
          </fieldset>
        </section>

        {/* 현금영수증/세금계산서 */}
        <ReceiptOptions />

        {/* CTA - 최종 결제 */}
        <footer className="mt-6">
          <p className="mb-2 text-center text-[11px] text-gray-600">
            결제 진행 시 개인정보 제공 및 이용약관에 동의한 것으로 간주됩니다.
          </p>
          <button className="w-full rounded bg-[#ff9f00] py-3 text-[15px] font-semibold text-white">
            20,500원 결제하기
          </button>
        </footer>
      </div>
    </main>
  )
}

function ReceiptOptions() {
  // 각 섹션의 라디오 버튼 상태를 관리합니다.
  const [cashReceiptOption, setCashReceiptOption] = useState("apply")
  const [taxInvoiceOption, setTaxInvoiceOption] = useState("noapply")

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
    <div className="w-full max-w-md space-y-6 rounded-lg bg-transparent p-4">
      {/* 현금영수증 섹션 */}
      <div>
        <div className="flex items-center justify-between">
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
        <div className="mt-3 rounded-lg bg-[#fff] p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-800">사업자</p>
              <p className="mt-1 text-sm text-gray-500">
                바나뷰티 010-101010-1020
              </p>
            </div>
            <button className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">
              변경
            </button>
          </div>
        </div>
      </div>

      {/* 세금계산서 섹션 */}
      <div>
        <div className="flex items-center justify-between">
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
        <div className="mt-3 rounded-lg bg-[#fff] p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-800">사업자</p>
              <p className="mt-1 text-sm text-gray-500">
                바나뷰티 010-101010-1020
              </p>
            </div>
            <button className="rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">
              변경
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
