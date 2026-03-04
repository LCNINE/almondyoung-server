type Props = {
  author: string
  tags: string[]
}

/**
 * @description 리뷰 작성자 정보 (이름, 사용자 태그)
 * 요약 카드, 상세 카드 모두에서 재사용
 */
export function ReviewAuthor({ author, tags }: Props) {
  return (
    <div className="flex items-center gap-2">
      <p className="flex-shrink-0 text-xs font-medium text-gray-600">
        {author}
      </p>

      {/* 태그 목록 <ul> */}
      <ul className="flex flex-wrap items-center gap-1">
        {tags.map((tag) => (
          <li
            key={tag}
            className="flex-shrink-0 rounded border border-green-600 px-1 py-0.5 text-[11px] font-medium text-green-600"
          >
            {tag}
          </li>
        ))}
      </ul>
    </div>
  )
}
