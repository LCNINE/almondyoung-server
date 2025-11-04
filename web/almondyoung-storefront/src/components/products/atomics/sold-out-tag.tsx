"use client"

import React from "react"

export const SoldOutTag = ({ isSoldOut }: { isSoldOut: boolean }) => {
  return (
    isSoldOut && (
      <span className="text-xs font-bold text-black md:text-base">품절</span>
    )
  )
}
