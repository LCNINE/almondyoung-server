import React, { useState } from "react"
import { OverlayDrawer } from "@components/sheet"

/**
 * [헬퍼] 원본 SVG를 재사용 가능한 아이콘 컴포넌트로 분리
 */

// 원본의 체크박스 아이콘 (비활성/활성 상태)
const CustomCheckboxIcon = ({ checked }: { checked: boolean }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <path
      d="M23.5 12C23.5 18.3513 18.3513 23.5 12 23.5C5.64873 23.5 0.5 18.3513 0.5 12C0.5 5.64873 5.64873 0.5 12 0.5C18.3513 0.5 23.5 5.64873 23.5 12Z"
      stroke={checked ? "currentColor" : "#ddd"} // 활성 시 색상 변경
      fill="none"
    />
    <path
      d="M7 12.6667L10.3846 16L18 8.5"
      stroke={checked ? "currentColor" : "#ddd"} // 활성 시 색상 변경
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

// 원본의 초기화 아이콘
const ResetIcon = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
    <path
      d="M13.78 3.96303C12.504 2.16973 10.4086 1 8.04 1C4.15192 1 1 4.15192 1 8.04C1 11.9281 4.15192 15.08 8.04 15.08C11.9281 15.08 15.08 11.9281 15.08 8.04"
      stroke="#333" // 원본은 #ddd 였으나, 활성 버튼이므로 #333으로 변경
      strokeWidth="1.6"
      strokeLinecap="square"
      strokeLinejoin="round"
    />
    <path
      d="M14.4933 1L14.4933 4.52H10.9733"
      stroke="#333"
      strokeWidth="1.6"
      strokeLinecap="square"
      strokeLinejoin="round"
    />
  </svg>
)

// --- [컴포넌트] 리팩터링된 모바일 필터 시트 ---

interface MobileFilterSheetProps {
  isOpen: boolean
  close: () => void
  exit: () => void
}

export function MobileFilterSheet({
  isOpen,
  close,
  exit,
}: MobileFilterSheetProps) {
  // 1. 상태 관리: 어떤 탭이 활성화되었는지 (원본은 '카테고리'가 활성)
  const [activeTab, setActiveTab] = useState("카테고리")

  // 2. 상태 관리: 어떤 카테고리가 체크되었는지 (예시)
  const [checkedItems, setCheckedItems] = useState<{ [key: string]: boolean }>({
    "스킨케어·메이크업": false,
    패션: false,
    // ...
  })

  // 3. 헬퍼 함수: 체크박스 토글
  const handleToggle = (label: string) => {
    setCheckedItems((prev) => ({
      ...prev,
      [label]: !prev[label],
    }))
  }

  // 4. (원본 데이터) 탭 및 필터 아이템
  const tabs = [
    "카테고리",
    "가격",
    "브랜드",
    "유형",
    "혜택",
    "포장타입",
    "배송",
    "특정상품 제외",
    "프로모션",
  ]
  const filterItems = [
    { label: "스킨케어·메이크업", count: 60 },
    { label: "패션", count: 59 },
    { label: "가구·인테리어", count: 51 },
    { label: "럭셔리뷰티", count: 37 },
    { label: "생활용품·리빙", count: 36 },
    { label: "유아동", count: 32 },
    { label: "간편식·밀키트·샐러드", count: 28 },
    { label: "간식·과자·떡", count: 25 },
    { label: "베이커리", count: 25 },
    { label: "건강식품", count: 22 },
    // ... (더 많은 아이템)
  ]

  // 5. 총 선택된 개수 계산 (예시)
  const selectedCount =
    Object.values(checkedItems).filter(Boolean).length || 575 // 원본의 '575'를 예시로 사용

  const handleApply = () => {
    // 필터 적용 후 시트 닫기
    close()
  }

  const handleReset = () => {
    // 모든 체크 해제
    setCheckedItems({})
  }

  return (
    <OverlayDrawer isOpen={isOpen} close={close} exit={exit} direction="bottom">
      {/* [구조] 
        `flex-col`을 사용하여 헤더/바디/푸터를 수직 정렬.
        `max-h-[85vh]`로 전체 화면을 덮지 않도록 설정.
      */}
      <div className="flex h-auto max-h-[85vh] flex-col">
        {/* [1. 헤더] 
        - 드래그 핸들 (시각적 요소)
        - "필터" 타이틀. `flex-shrink-0`로 높이 고정.
      */}
        <header className="shrink-0">
          <div className="flex justify-center py-3">
            <div className="h-1.5 w-10 rounded-full bg-gray-300"></div>
          </div>
          <h2 className="px-5 py-2 text-lg font-bold text-gray-900">필터</h2>
        </header>

        {/* [2. 탭 바] 
        - 시맨틱한 <nav> 태그 사용.
        - `overflow-x-auto`로 가로 스크롤 구현.
        - `<a>` 대신 `<button>` 사용.
        - `data-state`로 활성/비활성 상태 관리 (shadcn/ui 방식)
      */}
        <nav className="scrollbar-hide shrink-0 overflow-x-auto border-b border-gray-200">
          <div className="flex space-x-5 px-5 py-1">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className="py-3 text-sm font-medium whitespace-nowrap transition-colors data-[state=active]:font-bold data-[state=active]:text-primary data-[state=inactive]:text-gray-500"
                data-state={activeTab === tab ? "active" : "inactive"}
              >
                {tab}
              </button>
            ))}
          </div>
        </nav>

        {/* [3. 스크롤 영역] 
        - `flex-1 overflow-y-auto` : 헤더와 푸터를 제외한 나머지 영역을 차지하고,
          내용이 넘칠 경우 수직 스크롤됩니다.
      */}
        <div className="flex-1 overflow-y-auto">
          <ul className="divide-y divide-gray-100 px-5">
            {/* [4. 필터 아이템]
            - 원본의 <button>+<svg> 대신 시맨틱한 <input type="checkbox">와 <label> 사용.
            - `peer` 유틸리티로 커스텀 스타일링 구현 (시니어 퍼블리셔 방식)
          */}
            {filterItems.map((item) => (
              <li key={item.label} className="py-3">
                <label className="flex cursor-pointer items-center justify-between">
                  <div className="flex items-center gap-2">
                    {/* [시맨틱 체크박스]
                    - 실제 input은 숨깁니다 (`sr-only`)
                    - `peer`로 등록합니다.
                    - 아래 `div`가 `peer-checked:`를 감지하여 스타일을 바꿉니다.
                  */}
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={!!checkedItems[item.label]}
                      onChange={() => handleToggle(item.label)}
                    />
                    {/* 가상 체크박스 UI */}
                    <div
                      className={`h-5 w-5 ${checkedItems[item.label] ? "text-primary" : "text-gray-300"}`}
                    >
                      <CustomCheckboxIcon
                        checked={!!checkedItems[item.label]}
                      />
                    </div>
                    <span
                      className={`text-sm ${
                        checkedItems[item.label]
                          ? "font-semibold text-primary"
                          : "text-gray-800"
                      }`}
                    >
                      {item.label}
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">{item.count}</span>
                </label>
              </li>
            ))}
          </ul>
        </div>

        {/* [5. 고정 푸터] 
        - `flex-shrink-0`로 높이 고정.
        - `flex`와 `gap`으로 버튼 배치 (원본의 `space-between` 대체)
      */}
        <footer className="shrink-0s-center flex gap-3 border-t border-gray-200 p-4">
          {/* 초기화 버튼 */}
          <button
            type="button"
            onClick={handleReset}
            className="flex h-12 items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 transition-colors hover:bg-gray-50"
          >
            <ResetIcon />
            초기화
          </button>
          {/* 상품 보기 버튼 */}
          <button
            type="button"
            onClick={handleApply}
            className="bg-primary text-primary-foreground hover:bg-primary/90 h-12 flex-1 rounded-md px-6 text-base font-semibold transition-colors"
          >
            {selectedCount}개 상품 보기
          </button>
        </footer>
      </div>
    </OverlayDrawer>
  )
}
