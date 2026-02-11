"use client"

import { getThumbnailUrl } from "@lib/utils/get-thumbnail-url"

type Props = {
  thumbnails: string[]
  mainImage: string
  productName: string
  onImageChange: (image: string) => void
  isSoldOut?: boolean
}

/**
 * @description 상품 이미지 갤러리 (시맨틱 <figure> 사용)
 */
export function ProductImageGallery({
  thumbnails,
  mainImage,
  productName,
  onImageChange,
  isSoldOut = false,
}: Props) {
  return (
    <section className="mb-8 flex flex-col gap-4 px-0 md:flex-col-reverse lg:flex-row lg:px-14">
      {/* 썸네일 리스트 (데스크탑) */}
      <aside className="relative hidden md:flex md:flex-row lg:flex-col">
        <ScrollButton direction="left" />

        <nav
          id="thumbnail-scroll"
          className="flex gap-2 overflow-x-auto md:flex-row lg:flex-col"
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          aria-label="상품 이미지 썸네일"
        >
          {thumbnails.map((thumb, idx) => (
            <button
              key={idx}
              onClick={() => onImageChange(thumb)}
              className="h-20 w-20 min-w-20 shrink-0 overflow-hidden bg-gray-200"
              aria-label={`상품 이미지 ${idx + 1} 보기`}
            >
              <img
                src={getThumbnailUrl(thumb)}
                alt={`${productName} 썸네일 ${idx + 1}`}
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </nav>

        <ScrollButton direction="right" />
      </aside>

      {/* 메인 이미지 */}
      <figure className="relative flex-1">
        <div className="aspect-square overflow-hidden bg-gray-200">
          <img
            src={getThumbnailUrl(mainImage)}
            alt={`${productName} 메인 이미지`}
            className="h-full w-full object-cover"
          />
        </div>
        {isSoldOut && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 transition-opacity duration-300 hover:opacity-30">
            <span className="text-2xl font-bold text-white">일시 품절</span>
          </div>
        )}
      </figure>

      {/* 썸네일 리스트 (모바일) */}
      <nav
        className="flex flex-row gap-2 md:hidden"
        aria-label="상품 이미지 썸네일"
      >
        {thumbnails.map((thumb, idx) => (
          <button
            key={idx}
            onClick={() => onImageChange(thumb)}
            className="h-20 w-20 overflow-hidden bg-gray-200"
            aria-label={`상품 이미지 ${idx + 1} 보기`}
          >
            <img
              src={getThumbnailUrl(thumb)}
              alt={`${productName} 썸네일 ${idx + 1}`}
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </nav>
    </section>
  )
}

// 스크롤 버튼 컴포넌트
function ScrollButton({ direction }: { direction: "left" | "right" }) {
  const handleScroll = () => {
    const container = document.getElementById("thumbnail-scroll")
    if (container) {
      container.scrollBy({
        left: direction === "left" ? -100 : 100,
        behavior: "smooth",
      })
    }
  }

  return (
    <button
      onClick={handleScroll}
      className={`absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/80 p-1 shadow-md hover:bg-white lg:hidden ${
        direction === "left" ? "left-0" : "right-0"
      }`}
      aria-label={`${direction === "left" ? "이전" : "다음"} 이미지`}
    >
      <svg
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d={direction === "left" ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"}
        />
      </svg>
    </button>
  )
}
