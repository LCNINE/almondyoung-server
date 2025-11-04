"use client"

import React from "react"
import { MembershipTag } from "./membership-tag"
import { SoldOutTag } from "./sold-out-tag"
import AnimatedMembershipText from "@components/products/atomics/animated-membership-text"

/**
 * ProductPrice - 순수 표시 컴포넌트
 *
 * 책임:
 * 💻 프론트: 조건부 렌더링, 가격 포맷팅 (천단위 콤마)
 * 📡 서버: 가격 정보 제공 (원가, 할인가)
 *
 * 💡 할인율은 상위 컴포넌트에서 계산해서 전달
 */
export const ProductPrice = ({
  displayPrice, // 표시할 최종 가격 (할인 적용된 가격)
  originalPrice, // 원가 (할인 전, 옵셔널)
  discountRate, // 할인율 (%, 상위에서 계산)
  isSoldOut, // 품절 여부
  isMembershipOnly, // 멤버십 전용 여부
  showMembershipTag, // 멤버십 태그 표시 여부
  isTimeSale, // 타임세일 여부
}: {
  displayPrice: number
  originalPrice?: number
  discountRate?: number
  isSoldOut: boolean
  isMembershipOnly: boolean
  showMembershipTag: boolean
  isTimeSale?: boolean
}) => {
  // ===== 1. 품절 상품 =====
  if (isSoldOut) {
    return (
      <div className="flex flex-col gap-1 md:flex-row md:flex-wrap md:items-center md:gap-1.5">
        <span className="text-base font-bold text-gray-400 md:text-[19px]">
          {displayPrice.toLocaleString()}원
        </span>
        <SoldOutTag isSoldOut={true} />
      </div>
    )
  }

  // ===== 2. 멤버십 전용 상품 =====
  if (isMembershipOnly) {
    return (
      <div className="flex flex-col gap-1 md:flex-row md:flex-wrap md:items-center md:gap-1.5">
        <AnimatedMembershipText
          className="text-base font-bold md:text-[19px]"
          delay={6000}
          duration={1500}
        />
      </div>
    )
  }

  // ===== 3. 타임세일 상품 (할인 있음) =====
  if (isTimeSale && discountRate && originalPrice) {
    return (
      <div className="gap-0.7 flex flex-col">
        {/* 원가 (회색 취소선) */}
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium tracking-tight text-gray-400 line-through md:text-sm">
            {originalPrice.toLocaleString()}원
          </span>
        </div>

        {/* 할인가 (빨간색) + 멤버십 태그 */}
        <div className="flex flex-col gap-1 md:flex-row md:flex-wrap md:items-center md:gap-1.5">
          <span className="text-base font-bold text-[#f54527] md:text-[19px]">
            {displayPrice.toLocaleString()}원
          </span>
          {showMembershipTag && (
            <MembershipTag isMembership={true} isSoldOut={false} />
          )}
        </div>

        {/* 빨간색 할인 배지 */}
        <span className="mt-1 inline-flex items-center self-start rounded-[3px] bg-[#f54527] px-1 py-0.5 text-xs font-medium text-white">
          {discountRate}% 할인
        </span>
      </div>
    )
  }

  // ===== 4. 일반 상품 (할인 있음) =====
  if (discountRate && originalPrice) {
    return (
      <div className="gap-0.7 flex flex-col">
        {/* 할인율 + 원가 (같은 줄) */}
        <div className="flex items-center gap-1">
          <span className="text-xs tracking-tight text-gray-500 md:text-base">
            {discountRate}%
          </span>
          <span className="text-xs font-medium tracking-tight text-gray-400 line-through md:text-base">
            {originalPrice.toLocaleString()}원
          </span>
        </div>

        {/* 할인가 + 멤버십 태그 */}
        <div className="flex flex-col gap-1 md:flex-row md:flex-wrap md:items-center md:gap-1.5">
          <span className="text-base font-bold md:text-[19px]">
            {displayPrice.toLocaleString()}원
          </span>
          {showMembershipTag && (
            <MembershipTag isMembership={true} isSoldOut={false} />
          )}
        </div>
      </div>
    )
  }

  // ===== 5. 일반 상품 (할인 없음) =====
  return (
    <div className="flex flex-col gap-1 md:flex-row md:flex-wrap md:items-center md:gap-1.5">
      <span className="text-base font-bold md:text-[19px]">
        {displayPrice.toLocaleString()}원
      </span>
      {showMembershipTag && (
        <MembershipTag isMembership={true} isSoldOut={false} />
      )}
    </div>
  )
}
