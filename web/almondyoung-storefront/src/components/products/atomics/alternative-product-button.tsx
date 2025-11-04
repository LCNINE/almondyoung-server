"use client"

import React from "react"

export const AlternativeProductButton = ({
  isSoldOut,
}: {
  isSoldOut: boolean
}) => {
  const onAlternativeClick = () => {
    console.log("대체상품 보기")
  }
  return isSoldOut ? (
    <button
      onClick={onAlternativeClick}
      className="hidden w-full rounded-[5px] border border-orange-400 px-4 py-2.5 text-sm font-medium text-orange-400 transition-colors hover:bg-orange-50 md:block"
    >
      대체상품 보기
    </button>
  ) : null
}
