import React from "react"

interface WishlistIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number
  color?: string
}

export function WishlistIcon({
  size = 27,
  color = "#F29219",
  className,
  ...props
}: WishlistIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="-2 2 31 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: "block" }}
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M15.3008 4.66417C17.1836 3.46979 20.2244 2.34036 22.8504 5.0183C29.084 11.3753 18.3939 23.625 13.5 23.625C8.60611 23.625 -2.08405 11.3753 4.14959 5.01831C6.77555 2.34039 9.81634 3.4698 11.6992 4.66417C12.7631 5.33904 14.2369 5.33904 15.3008 4.66417ZM8.76243 7.53872C9.19803 7.37319 9.41696 6.88588 9.25142 6.45028C9.08589 6.01468 8.59858 5.79575 8.16298 5.96128C7.52089 6.20528 6.9001 6.60199 6.31936 7.17777C5.58323 7.90762 5.09279 8.73639 4.81872 9.62518C4.6814 10.0705 4.93107 10.5428 5.37637 10.6801C5.82166 10.8174 6.29397 10.5678 6.43128 10.1225C6.62249 9.5024 6.9655 8.91346 7.50747 8.37612C7.93304 7.95419 8.35664 7.69293 8.76243 7.53872Z"
        fill={color}
      />
    </svg>
  )
}
