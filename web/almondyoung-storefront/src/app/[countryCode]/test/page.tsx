import React from "react"
import {
  ChevronLeft,
  ChevronDown,
  Check,
  ChevronRight,
  RotateCcw,
} from "lucide-react"

interface PaymentAgreementProps {
  onBack?: () => void
}

// 공통 Input 스타일 컴포넌트 (Shadcn UI 느낌 + 디자인 커스텀)
const CustomInput = ({
  value,
  readOnly = false,
  className = "",
}: {
  value: string
  readOnly?: boolean
  className?: string
}) => (
  <div className="relative w-full">
    <input
      type="text"
      value={value}
      readOnly={readOnly}
      className={`w-full bg-[#f4f4f4] px-4 py-3 text-xs text-[#d9d9d9] placeholder:text-[#d9d9d9] focus:outline-none ${className}`}
    />
    {/* 디자인상의 하단 밑줄 구현 */}
    <div className="absolute bottom-0 left-0 h-[1px] w-full bg-[#8e8e93]" />
  </div>
)

// 정보 행 컴포넌트
const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start justify-between py-1">
    <span className="w-[100px] shrink-0 text-xs text-black">{label}</span>
    <span className="flex-1 text-left text-xs font-normal break-all text-[#1e1e1e]">
      {value}
    </span>
  </div>
)

// 체크박스 아이템 컴포넌트
const CheckboxItem = ({ label }: { label: string }) => (
  <div className="flex items-center gap-2.5">
    <div className="flex h-4 w-4 items-center justify-center rounded-[2px] bg-[#F29219]">
      <Check className="h-3 w-3 stroke-[3] text-white" />
    </div>
    <span className="text-xs text-[#1c1c1e]">{label}</span>
  </div>
)

// 약관 동의 리스트 아이템
const AgreementItem = ({ label }: { label: string }) => (
  <button className="flex w-full items-center justify-between py-2">
    <div className="flex items-center gap-2.5">
      <div className="h-4 w-4 rounded-sm border border-[#1c1c1e]" />
      <span className="text-[13px] text-[#1c1c1e]">{label}</span>
    </div>
    <ChevronDown className="h-5 w-5 text-[#1E1E1E]" />
  </button>
)

export default function RegularPaymentAgreement({
  onBack,
}: PaymentAgreementProps) {
  return (
    <div className="min-h-screen w-full bg-white text-[#1e1e1e]">
      {/* Container: 모바일 뷰 유지를 위한 최대 너비 설정 및 중앙 정렬 */}
      <div className="mx-auto flex max-w-md flex-col px-4 pt-2 pb-8">
        {/* Header */}
        <header className="mb-6 flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="-ml-2 rounded-full p-1 transition-colors hover:bg-gray-100"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          <h1 className="text-2xl font-bold">정기결제 동의서</h1>
        </header>

        {/* Content Area */}
        <main className="flex flex-col gap-6">
          {/* Section 1: 기본 정보 (Grid Layout 대신 Flex 사용으로 간격 제어) */}
          <section className="flex flex-col gap-3">
            <InfoRow label="결제 신청인" value="이연정" />
            <InfoRow label="회사명" value="블랙속눈썹" />
            <InfoRow label="결제자 휴대폰 번호" value="010-2020-2020" />
            <InfoRow label="계좌번호" value="우리은행 1239-*******-****23" />
            <InfoRow label="예금주(소유주)명" value="이연정" />

            <div className="mt-1 flex flex-col gap-2">
              <span className="text-xs text-black">결제자 생년월일</span>
              <CustomInput value="YYMMDD" readOnly />
            </div>
          </section>

          {/* Section 2: 결제일 설정 */}
          <section className="flex flex-col gap-2">
            <span className="text-xs text-black">결제일</span>
            <button className="flex w-full items-center justify-between border border-[#d9d9d9] bg-white px-4 py-3">
              <span className="text-xs text-[#1e1e1e]">매월 10일</span>
              <ChevronDown className="h-4 w-4 text-[#1E1E1E]" />
            </button>
          </section>

          {/* 
          <section className="flex flex-col gap-4">
            <span className="text-[11px] text-black">현금영수증 신청</span>

            <div className="flex flex-col gap-2">
              <CheckboxItem label="은행자동 이체 시 자동 발행" />
              <CheckboxItem label="사업자번호 동일" />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs text-black">현금영수증 수신 email</span>
              <CustomInput value="example@gmail.com" readOnly />
            </div>
          </section> */}

          {/* Section 4: 약관 동의 */}
          <section className="mt-4 flex flex-col gap-1">
            <AgreementItem label="[필수] 개인정보 수집 및 이용 동의" />
            <AgreementItem label="[필수] 개인정보 제3자 제공 동의" />
          </section>

          {/* Footer Area */}
          <section className="mt-6 flex flex-col gap-6">
            <p className="text-center text-[13px] text-[#1c1c1e]">
              위와 같이 정기결제 신청에 동의합니다.
            </p>

            <SignaturePad onConfirm={() => {}} onClear={() => {}} />
            <button className="w-full rounded-[5px] bg-[#f29219] py-3 text-sm font-semibold text-white transition-colors hover:bg-[#d98215] active:bg-[#bf7312]">
              정기결제 신청하기
            </button>
          </section>
        </main>
      </div>
    </div>
  )
}

interface SignaturePadProps {
  onConfirm?: () => void
  onClear?: () => void
}

function SignaturePad({ onConfirm, onClear }: SignaturePadProps) {
  return (
    // Card Container: 반응형 너비(max-w) 및 그림자 적용
    <div
      className="flex w-full max-w-[303px] flex-col gap-4 rounded-[10px] bg-white p-5 md:p-6"
      style={{ boxShadow: "0px 4px 4px 0 rgba(0,0,0,0.25)" }}
    >
      {/* Signature Canvas Area */}
      <div className="relative h-[156px] w-full rounded-[5px] bg-[#fff7e5]">
        {/* Placeholder Text: 실제 Canvas 구현 시 서명 시작하면 hidden 처리 필요 */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="text-[13px] text-[#c0c0c0]">여기에 서명하세요</p>
        </div>

        {/* Actual Canvas area would go here */}
        {/* <canvas className="w-full h-full block" /> */}

        {/* Reset Button: 서명 초기화 아이콘 */}
        <button
          type="button"
          onClick={onClear}
          aria-label="서명 초기화"
          className="absolute right-3 bottom-3 rounded-full p-1 transition-colors hover:bg-black/5"
        >
          <RotateCcw className="h-5 w-5 text-[#A86500]" strokeWidth={2} />
        </button>
      </div>

      {/* Confirm Button */}
      <button
        type="button"
        onClick={onConfirm}
        className="flex w-full items-center justify-center rounded-[5px] bg-[#f29219] py-2.5 text-xs font-medium text-white transition-colors hover:bg-[#d98215] active:bg-[#bf7312]"
      >
        확인
      </button>
    </div>
  )
}
