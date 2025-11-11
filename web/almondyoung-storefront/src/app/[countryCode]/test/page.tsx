import React from "react"
import {
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Home,
  Menu, // '카테고리' 아이콘으로 Menu 사용
  Search,
  ShoppingCart,
  User, // '마이' 아이콘으로 User 사용
} from "lucide-react"

// (BankVerifyForm 임포트는 원본 코드에 있었으나 실제 사용되지 않아 주석 처리합니다.)
// import BankVerifyForm from "domains/verify/bank"

/**
 * 페이지 전체 레이아웃
 */
export default function TestPage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col bg-white">
      {/* 1. 페이지 헤더 */}

      {/* 2. 메인 콘텐츠 (스크롤 영역) */}
      <div className="p-4">
        <form className="flex flex-col gap-8">
          {/* 결제 신청인 정보 섹션 */}
          <section aria-labelledby="applicant-info">
            <h2 id="applicant-info" className="sr-only">
              결제 신청인 정보
            </h2>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-3 text-xs">
              <dt className="text-black">결제 신청인</dt>
              <dd className="text-black">이연정</dd>

              <dt className="text-black">회사명</dt>
              <dd className="text-black">블랙속눈썹</dd>

              <dt className="text-black">결제자 휴대폰 번호</dt>
              <dd className="text-black">010-2020-2020</dd>

              <dt className="text-black">계좌번호</dt>
              <dd className="text-[#1e1e1e]">우리은행 1239-*******-****23</dd>

              <dt className="text-black">예금주(소유주)명</dt>
              <dd className="text-black">이연정</dd>
            </dl>
          </section>

          {/* 입력 필드 섹션 */}
          <section aria-labelledby="payment-info" className="space-y-5">
            <h2 id="payment-info" className="sr-only">
              결제 정보 입력
            </h2>

            <div>
              <label
                htmlFor="birthdate"
                className="mb-1.5 block text-xs text-black"
              >
                결제자 생년월일
              </label>
              <input
                type="text"
                id="birthdate"
                placeholder="YYMMDD"
                className="h-9 w-full bg-[#f4f4f4] px-4 py-3 text-xs text-gray-500 placeholder:text-[#d9d9d9] focus:border-[#8e8e93] focus:ring-0"
              />
            </div>

            <div>
              <label
                htmlFor="payment-day"
                className="mb-1.5 block text-xs text-black"
              >
                결제일
              </label>
              <div className="relative">
                <select
                  id="payment-day"
                  className="h-9 w-full appearance-none rounded-none border border-[#d9d9d9] bg-white py-2 pr-8 pl-4 text-xs text-[#1e1e1e]"
                >
                  <option>매월 10일</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3">
                  {/* [아이콘 교체] IconChevronDown -> ChevronDown */}
                  <ChevronDown className="h-4 w-4" />
                </div>
              </div>
            </div>

            <fieldset>
              <legend className="mb-2 text-[11px] text-black">
                현금영수증 신청
              </legend>
              <div className="space-y-2.5">
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    id="auto-issue"
                    defaultChecked
                    className="h-4 w-4 rounded-sm border-gray-300 text-[#F29219] focus:ring-[#F29219]"
                  />
                  <label
                    htmlFor="auto-issue"
                    className="text-xs text-[#1c1c1e]"
                  >
                    은행자동 이체 시 자동 발행
                  </label>
                </div>
                <div className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    id="same-as-biz"
                    defaultChecked
                    className="h-4 w-4 rounded-sm border-gray-300 text-[#F29219] focus:ring-[#F29219]"
                  />
                  <label
                    htmlFor="same-as-biz"
                    className="text-xs text-[#1c1c1e]"
                  >
                    사업자번호 동일
                  </label>
                </div>
              </div>
            </fieldset>

            <div>
              <label
                htmlFor="receipt-email"
                className="mb-1.5 block text-xs text-black"
              >
                현금영수증 수신 email
              </label>
              <input
                type="email"
                id="receipt-email"
                placeholder="example@gmail.com"
                className="h-9 w-full bg-[#f4f4f4] px-4 py-3 text-xs text-gray-500 placeholder:text-[#d9d9d9] focus:border-[#8e8e93] focus:ring-0"
              />
            </div>
          </section>

          {/* 약관 동의 섹션 */}
          <section aria-labelledby="terms-agreement" className="space-y-3 pt-4">
            <h2 id="terms-agreement" className="sr-only">
              약관 동의
            </h2>
            <AgreementItem text="[필수] 개인정보 수집 및 이용 동의" />
            <AgreementItem text="[필수] 개인정보 제3자 제공 동의" />
          </section>

          {/* 최종 동의 및 제출 */}
          <div className="space-y-3 pt-2">
            <p className="text-center text-[13px] text-[#1c1c1e]">
              위와 같이 정기결제 신청에 동의합니다.
            </p>
            <button
              type="submit"
              className="w-full rounded-[5px] bg-[#f29219] py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-[#e08616] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f29219]"
            >
              전자서명
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// --- 하위 컴포넌트 ---

/**
 * 앱 상단 헤더
 */
function AppHeader() {
  return (
    <header className="relative flex h-11 w-full flex-shrink-0 items-center justify-center border-b border-[#d9d9d9] px-4">
      <button
        type="button"
        aria-label="뒤로 가기"
        className="absolute top-1/2 left-4 -translate-y-1/2"
      >
        {/* [아이콘 교체] IconBack -> ChevronLeft */}
        <ChevronLeft className="h-5 w-5" />
      </button>
      <h1 className="text-center text-base font-bold text-black">
        정기결제 동의서
      </h1>
    </header>
  )
}

/**

 * 약관 동의 아이템
 */
function AgreementItem({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center justify-start gap-2.5">
        <input
          type="checkbox"
          aria-label={text}
          className="h-4 w-4 flex-shrink-0 rounded-sm border border-[#1c1c1e] focus:ring-blue-500"
        />
        <span className="text-left text-[13px] text-[#1c1c1e]">{text}</span>
      </div>
      <button type="button" aria-label={`${text} 상세보기`}>
        {/* [아이콘 교체] IconChevronRight -> ChevronRight */}
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  )
}

/**
 * 하단 내비게이션 아이템
 */
