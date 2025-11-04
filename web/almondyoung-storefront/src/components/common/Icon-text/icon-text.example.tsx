"use client"
// 아이콘 텍스트 컴포넌트 예시. 궁금하면 통째로 import해서 확인해보세요.
import React, { useState } from "react"
// 이전 단계에서 만들었던 풀네임 컴포넌트들을 import 합니다.
import { IconTextRoot, IconTextIcon, IconTextText } from "./icon-text.atomic"
// 아이콘 import
import {
  Home,
  Grid3X3,
  Search,
  Clock,
  User,
  ShoppingBag,
  Heart,
  RotateCcw,
  Settings,
} from "lucide-react"

/**
 * 상단 네비게이션 UI 컴포넌트
 */
export const TopNavigationBar = () => {
  const [activeTopTab, setActiveTopTab] = useState("orders")

  const navItems = [
    { id: "orders", label: "주문목록", icon: <ShoppingBag /> },
    { id: "wishlist", label: "찜한상품", icon: <Heart /> },
    { id: "frequent", label: "자주산상품", icon: <RotateCcw /> },
    { id: "custom", label: "맞춤정보", icon: <Settings /> },
  ]

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <h3 className="mb-4 text-center text-lg font-semibold">
        상단 네비게이션
      </h3>
      <div className="grid grid-cols-4 gap-2">
        {navItems.map((item) => {
          const variant = activeTopTab === item.id ? "active" : "default"
          return (
            <IconTextRoot
              key={item.id}
              onClick={() => setActiveTopTab(item.id)}
            >
              <IconTextIcon variant={variant}>{item.icon}</IconTextIcon>
              <IconTextText variant={variant}>{item.label}</IconTextText>
            </IconTextRoot>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 하단 네비게이션 UI 컴포넌트
 */
export const BottomNavigationBar = () => {
  const [activeTab, setActiveTab] = useState("home")

  const navItems = [
    { id: "home", label: "홈", icon: <Home /> },
    { id: "category", label: "카테고리", icon: <Grid3X3 /> },
    { id: "search", label: "검색", icon: <Search /> },
    { id: "recent", label: "최근본", icon: <Clock /> },
    { id: "my", label: "마이", icon: <User /> },
  ]

  return (
    <div className="rounded-lg bg-white shadow-sm">
      <h3 className="border-b p-4 text-center text-lg font-semibold">
        하단 네비게이션
      </h3>
      <div className="grid grid-cols-5">
        {navItems.map((item) => {
          const variant = activeTab === item.id ? "active" : "default"
          return (
            <IconTextRoot key={item.id} onClick={() => setActiveTab(item.id)}>
              <IconTextIcon variant={variant}>{item.icon}</IconTextIcon>
              <IconTextText variant={variant}>{item.label}</IconTextText>
            </IconTextRoot>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 다양한 크기 예시 UI 컴포넌트
 */
export const IconTextSizeVariants = () => {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <h3 className="mb-4 text-center text-lg font-semibold">다양한 크기</h3>
      <div className="space-y-4">
        {/* Small Size */}
        <div>
          <p className="mb-2 text-sm text-gray-600">Small Size</p>
          <div className="flex items-center gap-4">
            <IconTextRoot size="sm">
              <IconTextIcon variant="active" size="sm">
                <Home />
              </IconTextIcon>
              <IconTextText variant="active" size="sm">
                홈
              </IconTextText>
            </IconTextRoot>
            <IconTextRoot size="sm">
              <IconTextIcon size="sm">
                <Search />
              </IconTextIcon>
              <IconTextText size="sm">검색</IconTextText>
            </IconTextRoot>
          </div>
        </div>
        {/* Medium Size (Default) */}
        <div>
          <p className="mb-2 text-sm text-gray-600">Medium Size (Default)</p>
          <div className="flex items-center gap-4">
            <IconTextRoot>
              <IconTextIcon variant="active">
                <Home />
              </IconTextIcon>
              <IconTextText variant="active">홈</IconTextText>
            </IconTextRoot>
            <IconTextRoot>
              <IconTextIcon>
                <Search />
              </IconTextIcon>
              <IconTextText>검색</IconTextText>
            </IconTextRoot>
          </div>
        </div>
        {/* Large Size */}
        <div>
          <p className="mb-2 text-sm text-gray-600">Large Size</p>
          <div className="flex items-center gap-4">
            <IconTextRoot size="lg">
              <IconTextIcon variant="active" size="lg">
                <Home />
              </IconTextIcon>
              <IconTextText variant="active" size="lg">
                홈
              </IconTextText>
            </IconTextRoot>
            <IconTextRoot size="lg">
              <IconTextIcon size="lg">
                <Search />
              </IconTextIcon>
              <IconTextText size="lg">검색</IconTextText>
            </IconTextRoot>
          </div>
        </div>
      </div>
    </div>
  )
}
