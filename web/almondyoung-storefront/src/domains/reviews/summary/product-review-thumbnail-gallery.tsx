"use client"

type Thumbnail = {
  id: string
  src: string
  alt: string
}

export type ProductReviewThumbnailProps = {
  thumbnails: Thumbnail[]
  moreCount?: number
  onMoreClick?: () => void
}

/**
 * @description 상품 상세 리뷰 썸네일 이미지 갤러리
 * 모바일: 4개 이상일 때 마지막에 더보기
 * 데스크탑: 7개 이상일 때 마지막에 더보기
 */
export function ProductReviewThumbnailGallery({
  thumbnails,
  moreCount,
  onMoreClick,
}: ProductReviewThumbnailProps) {
  // 모바일: 3개 표시 + 더보기, 데스크탑: 6개 표시 + 더보기
  const mobileLimit = 3
  const desktopLimit = 6

  const showMoreButtonMobile = thumbnails.length > 3
  const showMoreButtonDesktop = thumbnails.length > 6

  // 모바일용 썸네일 (최대 3개 또는 4개)
  const mobileThumbnails = showMoreButtonMobile
    ? thumbnails.slice(0, mobileLimit)
    : thumbnails

  // 데스크탑용 썸네일 (최대 6개 또는 7개)
  const desktopThumbnails = showMoreButtonDesktop
    ? thumbnails.slice(0, desktopLimit)
    : thumbnails

  return (
    <>
      {/* 모바일 버전 (4열 그리드) */}
      <ul className="grid grid-cols-4 gap-2 md:hidden">
        {mobileThumbnails.map((thumb) => (
          <li key={thumb.id} className="aspect-square">
            <img
              src={thumb.src}
              alt={thumb.alt}
              className="h-full w-full rounded-md object-cover"
              loading="lazy"
            />
          </li>
        ))}

        {/* 더보기 버튼: 4개 이상일 때만 표시 */}
        {showMoreButtonMobile && (
          <li className="aspect-square">
            <button
              onClick={onMoreClick}
              className="relative flex h-full w-full flex-col items-center justify-center rounded-md text-white"
            >
              {/* 마지막 썸네일을 배경으로 */}
              <img
                src={thumbnails[mobileLimit]?.src || thumbnails[0].src}
                alt="리뷰 사진 더보기"
                className="absolute inset-0 h-full w-full rounded-md object-cover"
                loading="lazy"
              />
              {/* 어두운 오버레이 */}
              <div className="absolute inset-0 rounded-md bg-black/50" />
              {/* 텍스트 */}
              <span className="relative z-10 text-[13px] font-bold">
                {moreCount?.toLocaleString() || thumbnails.length - mobileLimit}
              </span>
              <span className="relative z-10 text-[8px]">더보기</span>
            </button>
          </li>
        )}
      </ul>

      {/* 데스크탑 버전 (7열 그리드) */}
      <ul className="hidden grid-cols-7 gap-2 md:grid">
        {desktopThumbnails.map((thumb) => (
          <li key={thumb.id} className="aspect-square">
            <img
              src={thumb.src}
              alt={thumb.alt}
              className="h-full w-full rounded-md object-cover"
              loading="lazy"
            />
          </li>
        ))}

        {/* 더보기 버튼: 7개 이상일 때만 표시 */}
        {showMoreButtonDesktop && (
          <li className="aspect-square">
            <button
              onClick={onMoreClick}
              className="relative flex h-full w-full flex-col items-center justify-center rounded-md text-white"
            >
              {/* 마지막 썸네일을 배경으로 */}
              <img
                src={thumbnails[desktopLimit]?.src || thumbnails[0].src}
                alt="리뷰 사진 더보기"
                className="absolute inset-0 h-full w-full rounded-md object-cover"
                loading="lazy"
              />
              {/* 어두운 오버레이 */}
              <div className="absolute inset-0 rounded-md bg-black/50" />
              {/* 텍스트 */}
              <span className="relative z-10 text-[13px] font-bold">
                {moreCount?.toLocaleString() ||
                  thumbnails.length - desktopLimit}
              </span>
              <span className="relative z-10 text-[8px]">더보기</span>
            </button>
          </li>
        )}
      </ul>
    </>
  )
}

