"use client"

import { useState } from "react"

type Props = {
  /**
   * 현재 선택된 평점 (0-5) - 클릭으로 설정된 값만
   * API 요청 시 이 값만 사용됨
   */
  rating: number
  /**
   * 평점 변경 핸들러 (외부에서 주입)
   * 외부에서 API 호출 등을 처리할 수 있도록 함
   */
  onChange?: (rating: number) => void
  /**
   * 별점 색상 (기본값: #FFA500)
   */
  activeColor?: string
  /**
   * 비활성 별점 색상 (기본값: #D9D9D9)
   */
  inactiveColor?: string
}

/**
 * 별점 컴포넌트
 * - 순수하게 rating 값을 받아서 표시
 * - onClick 액션은 외부에서 주입 (onRatingChange)
 * - hover는 컴포넌트 내부에서 일시적 UI 피드백으로만 처리
 * - rating 상태는 클릭한 값만 관리 (API 요청 시 사용)
 */
export function Rating({
  rating,
  onChange: onRatingChange,
  activeColor = "#FFA500",
  inactiveColor = "#D9D9D9",
}: Props) {
  // hover는 일시적 UI 피드백이므로 로컬 상태로만 관리
  // API 요청과 무관한 순수한 UI 상태
  const [hoveredRating, setHoveredRating] = useState(0)

  const getStarFill = (starValue: number) => {
    // hover 중이면 hover 값, 아니면 클릭한 rating 값 사용
    const displayRating = hoveredRating || rating
    return displayRating >= starValue ? activeColor : inactiveColor
  }

  return (
    <div
      className="flex justify-center gap-1"
      onMouseLeave={() => setHoveredRating(0)}
      role="radiogroup"
      aria-label="평점 선택"
    >
      {[1, 2, 3, 4, 5].map((starValue) => (
        <button
          key={starValue}
          type="button"
          onClick={() => onRatingChange?.(starValue)}
          onMouseEnter={() => setHoveredRating(starValue)}
          className="transition-transform hover:scale-110"
          aria-label={`${starValue}점`}
          aria-pressed={rating >= starValue}
        >
          <StarIcon fill={getStarFill(starValue)} />
        </button>
      ))}
    </div>
  )
}

// 개별 별 아이콘
function StarIcon({ fill }: { fill: string }) {
  return (
    <svg
      width={48}
      height={44}
      viewBox="0 0 48 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="h-11 w-12"
    >
      <path
        d="M21.8195 0.378273C21.8919 0.226449 22.1081 0.226449 22.1805 0.378273L28.2896 13.1808C28.3187 13.2419 28.3768 13.2841 28.4439 13.293L42.5077 15.1469C42.6745 15.1688 42.7413 15.3744 42.6193 15.4902L32.3311 25.2565C32.282 25.3031 32.2598 25.3714 32.2722 25.4379L34.855 39.3862C34.8856 39.5517 34.7108 39.6787 34.5629 39.5984L22.0954 32.8318C22.0359 32.7995 21.9641 32.7995 21.9046 32.8318L9.4371 39.5984C9.28925 39.6787 9.11441 39.5517 9.14504 39.3862L11.7278 25.4379C11.7402 25.3714 11.718 25.3031 11.6689 25.2565L1.38074 15.4902C1.25873 15.3744 1.32551 15.1688 1.4923 15.1469L15.5561 13.293C15.6232 13.2841 15.6813 13.2419 15.7104 13.1808L21.8195 0.378273Z"
        fill={fill}
      />
    </svg>
  )
}
