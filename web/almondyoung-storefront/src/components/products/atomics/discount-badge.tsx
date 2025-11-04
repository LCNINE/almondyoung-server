"use client"

import React from "react"

export const DiscountBadge = ({
  children,
  show,
}: {
  children: React.ReactNode
  show?: boolean
}) =>
  show ? (
    <span className="text-xs md:text-sm font-medium text-gray-500">
      {children}%
    </span>
  ) : null
