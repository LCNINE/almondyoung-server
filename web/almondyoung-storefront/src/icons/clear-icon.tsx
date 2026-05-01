import React from "react"

interface ClearIconProps extends React.SVGProps<SVGSVGElement> {
  size?: string
}

const ClearIcon: React.FC<ClearIconProps> = (props) => {
  const { size = "18" } = props
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <circle cx="9" cy="9" r="9" fill="currentColor" />
      <path
        d="M12.375 5.625L5.625 12.375"
        stroke="white"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.625 5.625L12.375 12.375"
        stroke="white"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
export default ClearIcon
