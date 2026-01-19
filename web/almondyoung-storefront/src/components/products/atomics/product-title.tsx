"use client"

import type { PropsWithChildren } from "react"

type ProductTitleProps = PropsWithChildren<{
  className?: string
}>

export const ProductTitle = ({ children, className = "" }: ProductTitleProps) => {
  return (
    <h3 className={`line-clamp-2 text-sm font-medium text-gray-900 ${className}`}>
      {children}
    </h3>
  )
}
