import { useHorizontalScroll } from "@components/section-sliders-horizontal/use-horizontal-scroll"

interface SectionSliderHorizontalProps {
  /**
   * 슬라이더 내부에 표시될 아이템들
   */
  children: React.ReactNode
  /**
   * 전체 아이템 개수 (스크롤 계산용)
   */
  itemCount: number
  /**
   * 섹션 제목 (선택사항)
   */
  title?: string
  /**
   * 제목 클래스 (선택사항)
   */
  titleClassName?: string
}

/**
 * 가로 스크롤 슬라이더 섹션 컴포넌트
 * 좌우 화살표 버튼으로 스크롤을 제어할 수 있습니다.
 */
export function SectionSliderHorizontal({
  children,
  itemCount,
  title,
  titleClassName = "mb-4 text-lg font-bold text-gray-900 md:text-xl",
}: SectionSliderHorizontalProps) {
  const { scrollRef, handleScrollPrev, handleScrollNext } =
    useHorizontalScroll(itemCount)

  return (
    <section className="mb-8">
      <div>
        {title && <h3 className={titleClassName}>{title}</h3>}
        <div className="relative">
          {/* 스크롤 컨테이너 */}
          <div
            ref={scrollRef}
            className="scroll-touch-only flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth md:gap-4"
          >
            {children}
          </div>

          {/* 왼쪽 화살표 버튼 (데스크톱만) */}
          <button
            onClick={handleScrollPrev}
            className="carousel-nav-btn absolute top-1/2 left-0 -translate-x-2 -translate-y-1/2 transition-opacity hover:opacity-80"
            aria-label="이전"
          >
            <svg
              width={43}
              height={82}
              viewBox="0 0 43 82"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="h-[82px] w-[43px]"
              preserveAspectRatio="none"
            >
              <rect
                x={43}
                y={82}
                width={43}
                height={82}
                transform="rotate(-180 43 82)"
                fill="black"
                fillOpacity="0.15"
              />
              <path
                d="M27.25 30.5L16.75 41L27.25 51.5"
                stroke="white"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          {/* 오른쪽 화살표 버튼 (데스크톱만) */}
          <button
            onClick={handleScrollNext}
            className="carousel-nav-btn absolute top-1/2 right-0 translate-x-2 -translate-y-1/2 transition-opacity hover:opacity-80"
            aria-label="다음"
          >
            <svg
              width={43}
              height={82}
              viewBox="0 0 43 82"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="h-[82px] w-[43px]"
              preserveAspectRatio="none"
            >
              <rect
                x={0}
                y={0}
                width={43}
                height={82}
                fill="black"
                fillOpacity="0.15"
              />
              <path
                d="M15.75 30.5L26.25 41L15.75 51.5"
                stroke="white"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </section>
  )
}
