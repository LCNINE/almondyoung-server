type Thumbnail = {
  src: string
  alt: string
}

type Props = {
  thumbnails: Thumbnail[]
}

/**
 * @description 가로 스크롤 썸네일 갤러리
 * CSS로 스크롤바를 숨김 (라이브러리 사용 안 함)
 */
export function ReviewThumbnailGallery({ thumbnails }: Props) {
  if (!thumbnails || thumbnails.length === 0) return null

  return (
    <ul
      className="flex gap-2 overflow-x-auto py-1"
      style={{
        scrollbarWidth: "none" /* Firefox */,
        msOverflowStyle: "none" /* IE/Edge */,
      }}
    >
      {thumbnails.map((thumb, index) => (
        <li key={index} className="flex-shrink-0">
          <img
            src={thumb.src}
            alt={thumb.alt}
            className="h-[74px] w-[74px] rounded-md object-cover"
            loading="lazy"
          />
        </li>
      ))}
      <style jsx>{`
        ul::-webkit-scrollbar {
          display: none; /* Chrome, Safari, Opera */
        }
      `}</style>
    </ul>
  )
}
