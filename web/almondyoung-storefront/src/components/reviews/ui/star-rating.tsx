/**
 * @description 5점 만점 별점 아이콘
 * @param rating - 0-5 사이의 숫자
 * @param size - 아이콘 크기 (Tailwind h- w- 값)
 */
export function StarRating({
  rating,
  size = "w-3 h-3",
}: {
  rating: number
  size?: string
}) {
  const fullStars = Math.floor(rating)
  const hasHalfStar = rating % 1 !== 0 // 반 별 표시는 원본 SVG에 없어 생략 (필요시 추가)
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0)

  return (
    <div
      className="flex items-center gap-px"
      aria-label={`평점 ${rating}점 / 5점 만점`}
    >
      {/* 꽉 찬 별 */}
      {[...Array(fullStars)].map((_, i) => (
        <StarIcon
          key={`full-${i}`}
          className={`${size} text-orange-400`}
          fill="currentColor"
        />
      ))}

      {/* TODO: 반 별 (필요시) */}

      {/* 빈 별 */}
      {[...Array(emptyStars)].map((_, i) => (
        <StarIcon
          key={`empty-${i}`}
          className={`${size} text-gray-300`}
          fill="currentColor"
        />
      ))}
    </div>
  )
}

// 개별 별 아이콘 (기존 SVG path 활용)
function StarIcon({
  className,
  fill = "none",
}: {
  className?: string
  fill?: string
}) {
  return (
    <svg
      width={14} // 원본 SVG 비율에 맞게 조정
      height={14}
      viewBox="0 0 16 16"
      fill={fill}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M7.8195 0.378273C7.89194 0.226449 8.10806 0.226449 8.1805 0.378273L10.2574 4.73069C10.2865 4.79179 10.3446 4.83399 10.4117 4.84284L15.1929 5.47309C15.3597 5.49507 15.4265 5.70061 15.3045 5.81643L11.8069 9.13661C11.7578 9.18322 11.7356 9.25151 11.7479 9.31808L12.626 14.06C12.6566 14.2254 12.4818 14.3524 12.3339 14.2722L8.0954 11.9718C8.0359 11.9395 7.9641 11.9395 7.9046 11.9718L3.66609 14.2722C3.51824 14.3524 3.3434 14.2254 3.37403 14.06L4.25209 9.31808C4.26442 9.25151 4.24223 9.18322 4.19313 9.13661L0.695529 5.81643C0.573522 5.70061 0.640305 5.49507 0.807085 5.47309L5.58826 4.84284C5.65539 4.83399 5.71347 4.79179 5.74263 4.73069L7.8195 0.378273Z" />
    </svg>
  )
}
