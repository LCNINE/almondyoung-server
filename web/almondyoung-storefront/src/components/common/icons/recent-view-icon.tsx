import React from "react"

interface RecentViewIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number
  color?: string
}

export function RecentViewIcon({
  size = 27,
  color = "#F29219",
  className,
  ...props
}: RecentViewIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 27 27"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {/* 1. 주황색 배경 (둥근 사각형) */}
      <rect x="2.25" y="4.5" width="22.5" height="18" rx="3" fill={color} />

      {/* 2. 가운데 흰색 선 (V자 모양) */}
      <path
        d="M2.25 12.5 H 9 L 13.5 16.5 L 18 12.5 H 24.75"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
