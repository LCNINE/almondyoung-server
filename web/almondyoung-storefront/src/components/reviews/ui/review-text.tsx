type Props = {
  text: string
  /**
   * line-clamp 적용 여부 (요약에서는 3줄, 상세에서는 제한 없음)
   */
  lineClamp?: 1 | 2 | 3 | 4 | 5 | 6
  /**
   * 더보기 버튼 표시 여부
   */
  showMoreButton?: boolean
  onMoreClick?: () => void
}

/**
 * @description 리뷰 본문 텍스트
 * line-clamp 옵션으로 요약/상세에서 재사용
 */
export function ReviewText({
  text,
  lineClamp,
  showMoreButton = false,
  onMoreClick,
}: Props) {
  // Tailwind의 line-clamp는 동적으로 생성되지 않으므로 명시적으로 작성
  const clampClass = lineClamp
    ? {
        1: "line-clamp-1",
        2: "line-clamp-2",
        3: "line-clamp-3",
        4: "line-clamp-4",
        5: "line-clamp-5",
        6: "line-clamp-6",
      }[lineClamp]
    : ""

  return (
    <div className="flex-1 space-y-2">
      <p className={`text-xs text-black ${clampClass}`}>
        {text.split("\n").map((line, i) => (
          <span key={i} className="block">
            {line}
          </span>
        ))}
      </p>
      {showMoreButton && (
        <button
          type="button"
          onClick={onMoreClick}
          className="text-[11px] font-medium text-gray-500"
        >
          더보기
        </button>
      )}
    </div>
  )
}
