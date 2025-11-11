import Image from "next/image"
import * as React from "react"

// --- 데이터 타입 및 더미 데이터 ---

// 더미 이미지 풀 (이미지가 없을 때 사용)
const PLACEHOLDER_IMAGES = [
  "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg",
  "https://almondyoung.com/web/product/medium/202402/9b57c6aa76f40052f31f2ea85c6876a7.jpg",
  "https://almondyoung.com/web/product/medium/202508/f78ca31bb7f7c9cb0461ba7bc24145dc.png",
  "https://almondyoung.com/web/product/medium/202508/c3a909e285d10ac83233c8dcc4e361f8.jpg",
  "https://almondyoung.com/web/product/medium/202501/38ddc4ccd1e0005e4ffa5275e1d5d033.jpg",
  "https://almondyoung.com/web/product/medium/202502/db90e9f1a6ccdf71d4aa82ed1d405981.png",
  "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg",
  "https://almondyoung.com/web/product/medium/202402/9b57c6aa76f40052f31f2ea85c6876a7.jpg",
  "https://almondyoung.com/web/product/medium/202508/f78ca31bb7f7c9cb0461ba7bc24145dc.png",
  "https://almondyoung.com/web/product/medium/202508/c3a909e285d10ac83233c8dcc4e361f8.jpg",
]

/**
 * 카테고리 탭 아이템의 데이터 구조
 */
export interface CategoryCircleTab {
  id: string
  name: string
  imageUrl?: string
}

/**
 * 메인 컴포넌트(`CategoryCircleTabs`)의 Props
 */
interface CategoryCircleTabsProps {
  items: CategoryCircleTab[]
  selectedId: string // onSelect가 필수이므로 selectedId도 필수로 간주
  /**
   * 탭 선택 시 호출되는 콜백 함수 (필수)
   */
  onSelect: (id: string) => void
}

// --- 내부 아이템 컴포넌트 ---

/**
 * (내부 사용)
 * 모바일/데스크톱이 통합된 단일 반응형 아이템 컴포넌트
 */
function CategoryCircleItem({
  name,
  imageUrl,
  id,
  isSelected,
  onSelect,
}: {
  name: string
  imageUrl: string
  id: string
  isSelected: boolean
  onSelect: (id: string) => void
}) {
  return (
    <li className="w-1/4 sm:w-1/3 md:w-1/4 lg:w-1/6">
      <button
        type="button"
        onClick={() => onSelect(id)}
        className={`flex w-full flex-col items-center gap-1.5 p-1 font-['Pretendard'] transition-opacity ${isSelected ? "opacity-100" : "opacity-60"} hover:opacity-80`}
      >
        {/* 이미지 래퍼 - 원래대로 w-full 유지 */}
        <div
          className={`flex aspect-square w-full items-center justify-center rounded-full transition-all md:p-3.5 ${
            isSelected
              ? "md:bg-black md:ring-2 md:ring-black md:ring-offset-2"
              : "md:bg-gray-100"
          }`}
        >
          <Image
            src={imageUrl}
            alt={`${name} 카테고리`}
            width={117}
            height={117}
            // CSS로 반응형 크기 직접 지정
            className="h-[72px] w-[72px] rounded-full object-cover md:h-full md:w-full"
          />
        </div>

        <p
          className={`text-Labels-Primary min-h-[32px] w-full text-center text-xs leading-snug font-medium md:min-h-11 md:text-lg md:font-semibold ${
            isSelected ? "text-black" : "text-gray-600"
          }`}
        >
          {name}
        </p>
      </button>
    </li>
  )
}

// --- 메인 컴포넌트 ---

/**
 * 원형 이미지와 텍스트로 구성된 카테고리 탭 목록을 표시하는 컴포넌트입니다.
 * 모바일에서는 4열, 데스크톱에서는 반응형으로 6열까지 표시됩니다.
 */
export function CategoryCircleTabs({
  items,
  selectedId,
  onSelect,
}: CategoryCircleTabsProps) {
  // 이미지가 없는 경우 랜덤 이미지 할당
  const itemsWithImages = items.map((item, index) => ({
    ...item,
    imageUrl:
      item.imageUrl || PLACEHOLDER_IMAGES[index % PLACEHOLDER_IMAGES.length],
  }))

  return (
    // 'flex-wrap'을 사용하여 아이템이 자동으로 다음 줄로 넘어가도록 설정
    <ul className="flex flex-wrap self-stretch">
      {itemsWithImages.map((item) => (
        <CategoryCircleItem
          key={item.id}
          id={item.id}
          name={item.name}
          imageUrl={item.imageUrl!}
          // [수정] onSelect 관련 조건문 제거
          isSelected={selectedId === item.id}
          onSelect={onSelect}
        />
      ))}
    </ul>
  )
}
