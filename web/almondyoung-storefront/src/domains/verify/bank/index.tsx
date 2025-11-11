import React from "react"

// --- 데이터 ---
// 이미지에 표시된 은행 목록
const banks = [
  "카카오뱅크",
  "농협",
  "국민",
  "신한",
  "우리",
  "기업",
  "하나",
  "새마을금고",
  "우체국",
  "SC제일",
  "iM뱅크(대구)",
  "부산",
  "경남",
  "광주",
  "신협",
  "수협",
  "한국산업",
  "전북",
  "제주",
  "씨티",
  "케이뱅크",
]

// --- 내부 컴포넌트 ---
// 이 파일 내에서만 사용되는 개별 은행 버튼 컴포넌트입니다.
interface BankButtonProps {
  name: string
}

/**
 * 계좌 선택 UI의 개별 은행 버튼
 * @param name - 은행 이름
 */
function BankButton({ name }: BankButtonProps) {
  return (
    <button
      type="button"
      // 버튼의 기본 스타일 및 레이아웃
      className="flex w-full flex-col items-center justify-center gap-2 rounded-lg bg-gray-100 p-2 transition-colors hover:bg-gray-200 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
    >
      {/* 아이콘 플레이스홀더 */}
      <div className="h-10 w-10 rounded-full bg-gray-300" aria-hidden="true">
        {/* 나중에 여기에 <Image> 또는 SVG 아이콘이 들어갑니다. */}
      </div>

      {/* 은행 이름 */}
      <span className="text-center text-sm font-medium text-gray-900">
        {name}
      </span>
    </button>
  )
}

// --- 메인 컴포넌트 ---
/**
 * 계좌 선택 UI 전체 섹션
 */
export default function BankVerifyForm() {
  return (
    <section className="mx-auto w-full max-w-md bg-white p-4">
      {/* 1. 시맨틱 마크업: 섹션의 제목(Heading) */}
      <h2 className="mb-6 text-center text-sm text-gray-700">
        본인 명의의 계좌만 등록 가능합니다.
      </h2>

      {/* 2. 시맨틱 마크업: 은행 '목록' (Unordered List) */}
      <ul className="grid grid-cols-3 gap-3">
        {banks.map((bankName) => (
          // 3. 시맨틱 마크업: 각 항목은 '리스트 아이템' (List Item)
          <li key={bankName}>
            {/* 4. 책임 분리: 버튼 로직은 BankButton 컴포넌트에 위임 */}
            <BankButton name={bankName} />
          </li>
        ))}
      </ul>
    </section>
  )
}

// 페이지에서 사용 예시:
// export default AccountSelection;
