"use client"

import { useState } from "react"

import {
  Clock,
  Heart,
  Home,
  Menu,
  RotateCcw,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  User,
} from "lucide-react"
import { IconTextIcon, IconTextLink, IconTextText } from "./icon-text.atomic"
// ==================================================================
// 파트 1: 기본 구성 요소 (Building Blocks)
// ==================================================================

// ==================================================================
// 파트 2: 독립적인 네비게이션 버튼 컴포넌트
// ==================================================================

/** 모든 버튼 컴포넌트가 공통으로 받는 Props */
interface NavButtonProps {
  /** 활성화 상태 여부 */
  isActive?: boolean
  /** 클릭 이벤트 핸들러 */
  onClick?: () => void
  size?: "sm" | "md" | "lg"
}

// --- 하단 네비게이션 버튼 ---

/** 홈 네비게이션 버튼 */
export const HomeNavButton = ({
  isActive,
  onClick,
  size = "md",
}: NavButtonProps) => {
  return (
    <IconTextLink to="/" size={size} variant={isActive ? "active" : "default"}>
      <IconTextIcon>
        <Home />
      </IconTextIcon>
      <IconTextText>홈</IconTextText>
    </IconTextLink>
  )
}

/** 카테고리 네비게이션 버튼 */
export const CategoryNavButton = ({
  isActive,
  onClick,
  size = "md",
}: NavButtonProps) => {
  const [isCategorySheetOpen, setIsCategorySheetOpen] = useState(false)

  const handleCategoryClick = () => {
    setIsCategorySheetOpen(true)
    onClick?.()
  }

  return (
    <>
      <button
        onClick={handleCategoryClick}
        className={`flex flex-col items-center gap-1 p-2 transition-colors ${
          isActive ? "text-yellow-30" : "text-gray-60"
        }`}
      >
        <IconTextIcon>
          <Menu />
        </IconTextIcon>
        <IconTextText>카테고리</IconTextText>
      </button>
      {/* 
      <CategorySheet
        isOpen={isCategorySheetOpen}
        onClose={() => setIsCategorySheetOpen(false)}
        countryCode="kr"
      /> */}
    </>
  )
}

export const CartNavButton = ({
  isActive,
  onClick,
  size = "md",
}: NavButtonProps) => {
  return (
    <IconTextLink
      to="/cart"
      size={size}
      variant={isActive ? "active" : "default"}
    >
      <IconTextIcon>
        <ShoppingCart />
      </IconTextIcon>
      <IconTextText>장바구니</IconTextText>
    </IconTextLink>
  )
}

/** 검색 네비게이션 버튼 */
export const SearchNavButton = ({
  isActive,
  onClick,
  size = "md",
}: NavButtonProps) => {
  return (
    <IconTextLink
      to="/search"
      size={size}
      variant={isActive ? "active" : "default"}
    >
      <IconTextIcon>
        <Search />
      </IconTextIcon>
      <IconTextText>검색</IconTextText>
    </IconTextLink>
  )
}

/** 최근 본 상품 네비게이션 버튼 */
export const RecentNavButton = ({
  isActive,
  onClick,
  size = "md",
}: NavButtonProps) => {
  const colorClass = isActive ? "text-yellow-30" : "text-gray-600"
  return (
    <IconTextLink to="/recent" size={size}>
      <Clock className={colorClass} />
      <IconTextText className={colorClass}>최근본</IconTextText>
    </IconTextLink>
  )
}

/** 마이페이지 네비게이션 버튼 */
export const MyPageNavButton = ({
  isActive,
  onClick,
  size = "md",
}: NavButtonProps) => {
  return (
    <IconTextLink
      to="/mypage"
      size={size}
      variant={isActive ? "active" : "default"}
    >
      <IconTextIcon>
        <User />
      </IconTextIcon>
      <IconTextText>마이</IconTextText>
    </IconTextLink>
  )
}

// --- 상단 네비게이션 버튼 ---

/** 주문 목록 네비게이션 버튼 */
export const OrderListNavButton = ({
  isActive,
  onClick,
  size = "md",
}: NavButtonProps) => {
  const colorClass = isActive ? "text-yellow-30" : "text-gray-600"
  return (
    <IconTextLink to="/order-list" size={size}>
      <ShoppingBag className={colorClass} />
      <IconTextText className={colorClass}>주문목록</IconTextText>
    </IconTextLink>
  )
}

/** 찜한 상품 네비게이션 버튼 */
export const WishlistNavButton = ({
  isActive,
  onClick,
  size = "md",
}: NavButtonProps) => {
  const colorClass = isActive ? "text-yellow-30" : "text-gray-600"
  return (
    <IconTextLink to="/wishlist" size={size}>
      <Heart className={colorClass} />
      <IconTextText className={colorClass}>찜한상품</IconTextText>
    </IconTextLink>
  )
}

/** 자주 산 상품 네비게이션 버튼 */
export const FrequentPurchaseNavButton = ({
  isActive,
  onClick,
  size = "md",
}: NavButtonProps) => {
  const colorClass = isActive ? "text-yellow-30" : "text-gray-600"
  return (
    <IconTextLink to="/frequent" size={size}>
      <RotateCcw className={colorClass} />
      <IconTextText className={colorClass}>자주산상품</IconTextText>
    </IconTextLink>
  )
}

/** 맞춤 정보 네비게이션 버튼 */
export const CustomInfoNavButton = ({
  isActive,
  onClick,
  size = "md",
}: NavButtonProps) => {
  const colorClass = isActive ? "text-yellow-30" : "text-gray-600"
  return (
    <IconTextLink to="/custom" size={size}>
      <Settings className={colorClass} />
      <IconTextText className={colorClass}>맞춤정보</IconTextText>
    </IconTextLink>
  )
}
