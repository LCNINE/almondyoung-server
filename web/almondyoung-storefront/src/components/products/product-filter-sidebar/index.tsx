import React from "react" // (Next.js/React 가정)
import Link from "next/link"

// --- 1. 시맨틱 아이콘 컴포넌트 (임시) ---
// 원본의 outline/absolute 대신 SVG 또는 CSS로 만드는 것이 좋습니다.
// 여기서는 간단한 텍스트로 대체합니다.
const IconMinus = () => <span className="text-stone-900">-</span>
const IconPlus = () => <span className="text-stone-900">+</span>

// --- 2. [컴포넌트화] 카테고리 링크 아이템 ---
// (이 아이템은 아코디언으로 작동한다고 가정합니다)
interface CategoryLinkProps {
  label: string
  href?: string
  isActive?: boolean
  isExpandable?: boolean
  isExpanded?: boolean // (실제로는 state로 관리)
}

function CategoryLink({
  label,
  href = "#",
  isActive = false,
  isExpandable = false,
  isExpanded = false,
}: CategoryLinkProps) {
  return (
    <li className="self-stretch">
      <Link
        href={href}
        className="flex w-full items-center justify-between py-1"
      >
        <span
          className={`font-['Pretendard'] text-base ${
            isActive
              ? "font-bold text-blue-600" // 활성/선택됨 (예시)
              : "font-bold text-stone-900"
          } `}
        >
          {label}
        </span>
        {/* 확장/축소 아이콘 */}
        {isExpandable && (isExpanded ? <IconMinus /> : <IconPlus />)}
      </Link>
      {/* (참고: isExpanded가 true일 때 
        여기에 서브 카테고리 <ul>이 렌더링되어야
        완전한 아코디언이 됩니다.)
      */}
    </li>
  )
}

// --- 3. [컴포넌트화] 접근성을 준수하는 체크박스 아이템 ---
// (가장 큰 변화: div가 아닌 실제 input/label 사용)
interface CheckboxItemProps {
  id: string
  label: string
}

function CheckboxItem({ id, label }: CheckboxItemProps) {
  return (
    // 'relative'와 'absolute'를 제거하고 flex로 배치
    <div className="flex items-center gap-2.5">
      <input
        type="checkbox"
        id={id}
        className="peer sr-only" // 실제 체크박스는 숨김
      />
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2.5">
        {/* 'peer-checked'를 사용해 숨겨진 input의 상태에 따라
          가상 체크박스의 스타일을 제어합니다. (견고한 설계)
        */}
        <div
          className="flex h-4 w-4 items-center justify-center rounded-sm border border-zinc-900 peer-checked:border-blue-600 peer-checked:bg-blue-600"
          aria-hidden="true"
        >
          {/* 체크 아이콘 (SVG가 가장 좋음) */}
          <svg
            className="hidden h-3 w-3 text-white peer-checked:block"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <span className="font-['Noto_Sans_KR'] text-sm leading-5 font-normal text-zinc-900">
          {label}
        </span>
      </label>
    </div>
  )
}

// --- 4. [컴포넌트화] 반복되는 필터 그룹 ---
interface FilterGroupProps {
  title: string
  items: { id: string; label: string }[]
  showMore?: boolean
}

function FilterGroup({ title, items, showMore = false }: FilterGroupProps) {
  return (
    // 시맨틱한 <fieldset>과 <legend>를 사용
    <fieldset className="w-full">
      <legend className="mt-4 mb-4 self-stretch font-['Pretendard'] text-lg font-bold text-black">
        {title}
      </legend>

      {/* 원본의 'px-5' 들여쓰기 적용 */}
      <div className="flex flex-col items-start gap-2.5 pl-5">
        {items.map((item) => (
          <CheckboxItem key={item.id} id={item.id} label={item.label} />
        ))}
      </div>

      {showMore && (
        <button
          type="button"
          className="mt-4 self-stretch font-['Pretendard'] text-base font-normal text-blue-600"
        >
          + 더보기
        </button>
      )}
    </fieldset>
  )
}

// --- 5. [데이터] 컴포넌트에 주입할 데이터 ---
// (실제로는 API 또는 상위에서 props로 받음)
const categoryData = [
  { label: "래쉬", isActive: true, isExpandable: false },
  { label: "영양제", isExpandable: false },
  { label: "글루", isExpandable: false },
  { label: "펌글루&왁스", isExpandable: true }, // (원본에 아이콘이 있었음)
  { label: "롯드", isExpandable: false },
  { label: "핀셋", isExpandable: false },
  { label: "리무버&전처리제", isExpandable: true },
  { label: "테이프", isExpandable: false },
  { label: "부자재", isExpandable: true },
  { label: "세트", isExpandable: false },
]
const brandData = [
  { id: "brand-1", label: "체크박스 아이템" },
  { id: "brand-2", label: "체크박스 아이템" },
  // ... (9개 항목)
]
const curlData = [
  { id: "curl-c", label: "C" },
  { id: "curl-j", label: "J" },
  { id: "curl-d", label: "D" },
  { id: "curl-b", label: "B" },
  // ...
]
const typeData = [
  { id: "type-1", label: "내추럴모" },
  { id: "type-2", label: "실크모" },
  // ...
]
const colorData = [
  { id: "color-1", label: "블랙" },
  { id: "color-2", label: "브라운" },
  // ...
]
const volumeData = [
  { id: "vol-1", label: "500ml 이상" },
  { id: "vol-2", label: "100-499ml" },
  // ...
]

// --- 6. 최종 렌더링 컴포넌트 ---
export default function ProductFilterSidebar() {
  return (
    // PARENT:
    // - <div> 대신 <form>이 가장 시맨틱합니다. (필터 = 입력)
    // - 원본의 스타일을 유지 (max-w, min-w, padding, border)
    <form className="hidden w-full max-w-60 min-w-56 flex-col items-start gap-7 rounded-2xl border border-gray-300 px-7 py-10 font-['Pretendard'] md:block">
      {/* 1. 카테고리 섹션 */}
      <nav aria-label="카테고리" className="flex w-full flex-col gap-4">
        <h2 className="self-stretch text-lg font-bold text-stone-900">
          카테고리
        </h2>
        <ul className="flex flex-col items-start gap-3 pl-5">
          {categoryData.map((item) => (
            <CategoryLink key={item.label} {...item} />
          ))}
        </ul>
      </nav>

      {/* 구분선 */}
      <hr className="my-[16px] w-full border-gray-300" />

      {/* 2. 브랜드 필터 (컴포넌트 사용) */}
      <FilterGroup title="브랜드" items={brandData} showMore={true} />

      {/* 구분선 */}
      <hr className="my-[16px] w-full border-gray-300" />

      {/* 3. 컬 모양 필터 (컴포넌트 사용) */}
      <FilterGroup title="컬 모양" items={curlData} />

      {/* 구분선 */}
      <hr className="my-[16px] w-full border-gray-300" />

      {/* 4. 종류 필터 (컴포넌트 사용) */}
      <FilterGroup title="종류" items={typeData} />

      {/* 구분선 */}
      <hr className="my-[16px] w-full border-gray-300" />

      {/* 5. 컬러 필터 (컴포넌트 사용) */}
      <FilterGroup title="컬러" items={colorData} />

      {/* 구분선 */}
      <hr className="my-[16px] w-full border-gray-300" />

      {/* 6. 용량 필터 (컴포넌트 사용) */}
      <FilterGroup title="용량" items={volumeData} />
    </form>
  )
}
