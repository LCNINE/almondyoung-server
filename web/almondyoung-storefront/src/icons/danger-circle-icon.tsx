import React from "react"

interface DangerCircleIconProps extends React.SVGProps<SVGSVGElement> {
  size?: string | number
}

const DangerCircleIcon: React.FC<DangerCircleIconProps> = (props) => {
  const { size = 12, ...rest } = props
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...rest}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.6667 5.83333C11.6667 9.055 9.055 11.6667 5.83333 11.6667C2.61167 11.6667 0 9.055 0 5.83333C0 2.61167 2.61167 0 5.83333 0C9.055 0 11.6667 2.61167 11.6667 5.83333ZM5.83333 2.47917C6.07496 2.47917 6.27083 2.67504 6.27083 2.91667V6.41667C6.27083 6.65829 6.07496 6.85417 5.83333 6.85417C5.59171 6.85417 5.39583 6.65829 5.39583 6.41667V2.91667C5.39583 2.67504 5.59171 2.47917 5.83333 2.47917ZM5.83333 8.75C6.1555 8.75 6.41667 8.48883 6.41667 8.16667C6.41667 7.8445 6.1555 7.58333 5.83333 7.58333C5.51117 7.58333 5.25 7.8445 5.25 8.16667C5.25 8.48883 5.51117 8.75 5.83333 8.75Z"
        fill="#F54527"
      />
    </svg>
  )
}

export default DangerCircleIcon
