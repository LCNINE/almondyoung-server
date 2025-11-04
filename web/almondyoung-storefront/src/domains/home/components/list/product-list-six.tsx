import { cn } from "@lib/utils"
import { ProductCard } from "@lib/types/ui/product"
import React from "react"

// --- 1. 슬라이더 프로그레스 (내부 컴포넌트) ---
function RankSliderProgress({ className }: { className?: string }) {
  // md:hidden: 모바일에서만 보이고 데스크탑에선 숨김
  return (
    <div
      className={cn(
        "mt-5 flex items-center justify-center gap-1.5 md:hidden",
        className
      )}
      aria-hidden="true"
    >
      <div className="h-[5px] w-3.5 rounded-full bg-black" />
      <div className="h-[5px] w-1.5 rounded-full bg-zinc-300" />
    </div>
  )
}

// --- 2. Chunk 헬퍼 함수 ---
// 배열을 n개 단위로 묶어주는 헬퍼
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

// --- 3. ProductListSix 메인 컴포넌트 ---
interface ProductListSixProps {
  products: ProductCard[]
  renderCard: (product: ProductCard, index: number) => React.ReactNode
  className?: string
}

export default function ProductListSix({
  products,
  renderCard,
  className = "",
}: ProductListSixProps) {
  // [모바일용 데이터] 6개씩 묶어 '페이지'로 만듭니다. (최대 2페이지, 12개)
  const mobilePages = React.useMemo(() => {
    return chunkArray(products.slice(0, 12), 6)
  }, [products])

  // [데스크탑용 데이터] 10개만 사용합니다.
  const desktopProducts = React.useMemo(() => {
    return products.slice(0, 10)
  }, [products])

  return (
    // PARENT: 리스트와 프로그레스 UI를 감싸는 래퍼
    <div className={cn("w-full", className)}>
      {/* --- [A] 모바일 뷰 (md:hidden) --- */}
      {/* 페이지 단위 슬라이드를 위한 스크롤 스냅 컨테이너 */}
      <div
        className={cn(
          "scrollbar-hide scroll-snap-type-x-mandatory overflow-x-auto scroll-smooth",
          "md:hidden" // 데스크탑에서 이 전체 스크롤 래퍼를 숨김
        )}
      >
        <div className="flex">
          {mobilePages.map((pageProducts, pageIndex) => (
            // 1. 각 '페이지' (슬라이드 1개)
            <div
              key={`page-${pageIndex}-${pageIndex * Math.random()}`}
              className="scroll-snap-align-start w-full flex-shrink-0"
            >
              {/* [핵심] 3x2 그리드 (1 2 3 / 4 5 6) */}
              <div className="grid grid-cols-3 gap-x-2.5 gap-y-4">
                {pageProducts.map((product, productIndex) => (
                  <div
                    key={productIndex + pageIndex * Math.random()}
                    className="w-28 flex-shrink-0" // Figma 시안 w-28
                  >
                    {/* 랭킹(index)이 올바르게 계산되도록 수정 */}
                    {renderCard(product, pageIndex * 6 + productIndex)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* --- [B] 데스크탑 뷰 (hidden md:grid) --- */}
      {/* [핵심] 5x2 그리드 (1 2 3 4 5 / 6 7 8 9 10) */}
      <div
        className={cn(
          "hidden", // 모바일에서 숨김
          "md:grid md:grid-cols-5 md:gap-4" // 5열 그리드
        )}
      >
        {desktopProducts.map((product, index) => (
          // w-auto를 적용할 필요 없이 그리드 아이템으로 바로 렌더링
          <div key={index + Math.random()}>{renderCard(product, index)}</div>
        ))}
      </div>

      {/* 3. 프로그레스 UI (md:hidden이 적용되어 모바일에만 보임) */}
      <RankSliderProgress />
    </div>
  )
}
