"use client"

import Link from "next/link"
import { useState } from "react"

interface PageInfo {
  id: string
  title: string
  path: string
  isChecked: boolean
  step?: 2 | 3 // step 1은 목록에 있다는 것 자체가 의미
  description?: string
}

interface PageCategory {
  category: string
  pages: PageInfo[]
}

export default function SitemapPage() {
  const [sitemapData, setSitemapData] = useState<PageCategory[]>([
    {
      category: "🏠 메인",
      pages: [
        {
          id: "home",
          title: "홈",
          path: "/kr",
          isChecked: true,
          step: 2,
          description: "JSON 데이터로 렌더링 중",
        },
        {
          id: "best",
          title: "베스트",
          path: "/kr/best",
          isChecked: true,
          step: 2,
          description: "JSON 데이터로 렌더링 중",
        },
        {
          id: "new",
          title: "신상품",
          path: "/kr/new",
          isChecked: true,
          step: 2,
          description: "JSON 데이터로 렌더링 중",
        },
        {
          id: "search",
          title: "검색",
          path: "/kr/search",
          isChecked: true,
          step: 2,
        },
      ],
    },
    {
      category: "🛍️ 상품",
      pages: [
        {
          id: "product-detail",
          title: "상품 상세",
          path: "/kr/products/1",
          isChecked: true,
          step: 2,
          description: "JSON 데이터로 렌더링 중",
        },
        {
          id: "category-hair",
          title: "카테고리 - 헤어",
          path: "/kr/category/hair",
          isChecked: true,
          step: 2,
          description: "JSON 데이터로 렌더링 중",
        },
        {
          id: "category-makeup",
          title: "카테고리 - 메이크업",
          path: "/kr/category/makeup",
          isChecked: true,
          step: 2,
          description: "JSON 데이터로 렌더링 중",
        },
        {
          id: "category-skin",
          title: "카테고리 - 스킨케어",
          path: "/kr/category/skin",
          isChecked: true,
          step: 2,
          description: "JSON 데이터로 렌더링 중",
        },
        {
          id: "category-nail",
          title: "카테고리 - 네일",
          path: "/kr/category/nail",
          isChecked: true,
          step: 2,
          description: "JSON 데이터로 렌더링 중",
        },
        {
          id: "category-lash",
          title: "카테고리 - 속눈썹",
          path: "/kr/category/lash",
          isChecked: true,
          step: 2,
          description: "JSON 데이터로 렌더링 중",
        },
        {
          id: "category-semi",
          title: "카테고리 - 반영구",
          path: "/kr/category/semi",
          isChecked: true,
          step: 2,
          description: "JSON 데이터로 렌더링 중",
        },
        {
          id: "category-tatoo",
          title: "카테고리 - 타투",
          path: "/kr/category/tatoo",
          isChecked: true,
          step: 2,
          description: "JSON 데이터로 렌더링 중",
        },
        {
          id: "category-class",
          title: "카테고리 - 클래스",
          path: "/kr/category/class",
          isChecked: true,
          step: 2,
          description: "JSON 데이터로 렌더링 중",
        },
      ],
    },
    {
      category: "🛒 장바구니 & 주문",
      pages: [
        {
          id: "cart",
          title: "장바구니",
          path: "/kr/cart",
          isChecked: true,
          step: 2,
          description: "UI 완료, mock 데이터 사용 중",
        },
        {
          id: "checkout",
          title: "주문/결제",
          path: "/kr/checkout",
          isChecked: true,
          step: 2,
          description: "UI 완료, 하드코딩 데이터 사용 중",
        },
        {
          id: "checkout-success",
          title: "주문 완료",
          path: "/kr/success",
          isChecked: true,
          step: 2,
          description: "UI 완료, 하드코딩 데이터 사용 중",
        },
        {
          id: "order-address",
          title: "배송지 관리",
          path: "/kr/order/address",
          isChecked: true,
          step: 2,
        },
        {
          id: "order-address-list",
          title: "배송지 목록",
          path: "/kr/order/address/list",
          isChecked: true,
          step: 2,
        },
        {
          id: "order-track",
          title: "주문 추적",
          path: "/kr/order/track",
          isChecked: true,
          step: 2,
        },
      ],
    },
    {
      category: "👤 회원 인증",
      pages: [
        {
          id: "login",
          title: "로그인",
          path: "/kr/login",
          isChecked: true,
          step: 3,
          description: "API 연동 완료",
        },
        {
          id: "signup",
          title: "회원가입",
          path: "/kr/signup",
          isChecked: true,
          step: 3,
          description: "API 연동 완료",
        },
        {
          id: "find-id",
          title: "아이디 찾기",
          path: "/kr/find/id",
          isChecked: true,
          step: 2,
        },
        {
          id: "find-password",
          title: "비밀번호 찾기",
          path: "/kr/find/password",
          isChecked: true,
          step: 2,
        },
        {
          id: "shop-survey",
          title: "샵 설문조사",
          path: "/kr/shop-survey",
          isChecked: true,
          step: 2,
        },
        {
          id: "social-callback",
          title: "소셜 로그인 콜백",
          path: "/kr/google/callback",
          isChecked: true,
          step: 2,
          description: "동적 라우트: [social]/callback",
        },
        {
          id: "callback-signup",
          title: "콜백 회원가입",
          path: "/kr/callback/signup",
          isChecked: true,
          step: 2,
        },
      ],
    },
    {
      category: "📱 마이페이지",
      pages: [
        {
          id: "mypage",
          title: "마이페이지 홈",
          path: "/kr/mypage",
          isChecked: true,
          step: 2,
        },
        {
          id: "mypage-order-list",
          title: "주문 내역",
          path: "/kr/mypage/order/list",
          isChecked: true,
          step: 2,
        },
        {
          id: "mypage-order-details",
          title: "주문 상세",
          path: "/kr/mypage/order/details",
          isChecked: true,
          step: 2,
        },
        {
          id: "mypage-order-track",
          title: "배송 추적",
          path: "/kr/mypage/order/track",
          isChecked: true,
          step: 2,
        },
        {
          id: "mypage-exchange",
          title: "교환/반품",
          path: "/kr/mypage/exchange",
          isChecked: true,
          step: 2,
        },
        {
          id: "mypage-wish",
          title: "위시리스트",
          path: "/kr/mypage/wish",
          isChecked: true,
          step: 2,
        },
        {
          id: "mypage-recent",
          title: "최근 본 상품",
          path: "/kr/mypage/recent",
          isChecked: true,
          step: 2,
          description: "UI 완료, mock 데이터 사용 중",
        },
        {
          id: "mypage-rebuy",
          title: "재구매",
          path: "/kr/mypage/rebuy",
          isChecked: true,
          step: 2,
        },
        {
          id: "mypage-reviews",
          title: "리뷰 관리",
          path: "/kr/mypage/reviews",
          isChecked: true,
          step: 2,
        },
        {
          id: "mypage-download",
          title: "다운로드",
          path: "/kr/mypage/download",
          isChecked: true,
          step: 2,
        },
        {
          id: "mypage-setting",
          title: "설정",
          path: "/kr/mypage/setting",
          isChecked: true,
          step: 2,
        },
        {
          id: "mypage-point",
          title: "포인트",
          path: "/kr/mypage/point",
          isChecked: true,
          step: 2,
          description: "UI 완료, BNPL 히스토리는 Drawer로 통합",
        },
        {
          id: "mypage-verify",
          title: "본인 인증",
          path: "/kr/mypage/identity-verify",
          isChecked: true,
          step: 2,
        },
      ],
    },
    {
      category: "💳 결제 수단",
      pages: [
        {
          id: "payment-methods",
          title: "결제 수단 관리",
          path: "/kr/mypage/payment-methods",
          isChecked: true,
          step: 2,
          description: "UI 완료, 카드/계좌 추가는 Drawer로 통합",
        },
      ],
    },
    {
      category: "👑 멤버십",
      pages: [
        {
          id: "membership",
          title: "멤버십 현황",
          path: "/kr/mypage/membership",
          isChecked: true,
          step: 2,
          description: "UI 구현 완료, API 연동 대기 중",
        },
        {
          id: "membership-subscribe",
          title: "멤버십 구독",
          path: "/kr/mypage/membership/subscribe",
          isChecked: true,
          step: 2,
        },
        {
          id: "membership-payment",
          title: "멤버십 결제",
          path: "/kr/mypage/membership/subscribe/payment",
          isChecked: true,
          step: 2,
        },
        {
          id: "membership-payment-method",
          title: "멤버십 결제 수단",
          path: "/kr/mypage/membership/payment-method",
          isChecked: true,
          step: 2,
        },
        {
          id: "membership-success",
          title: "멤버십 구독 성공",
          path: "/kr/mypage/membership/subscribe/success",
          isChecked: true,
          step: 2,
        },
        {
          id: "membership-fail",
          title: "멤버십 구독 실패",
          path: "/kr/mypage/membership/subscribe/fail",
          isChecked: true,
          step: 2,
        },
        {
          id: "subscribe-manage",
          title: "구독 관리",
          path: "/kr/mypage/subscribe/manage",
          isChecked: true,
          step: 2,
        },
      ],
    },
  ])

  const toggleCheck = (categoryIndex: number, pageIndex: number) => {
    setSitemapData((prev) => {
      const newData = [...prev]
      newData[categoryIndex].pages[pageIndex].isChecked =
        !newData[categoryIndex].pages[pageIndex].isChecked
      return newData
    })
  }

  const getStepBadge = (step?: 2 | 3) => {
    if (!step) {
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800">
          Step 1
        </span>
      )
    }
    if (step === 2) {
      return (
        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          Step 2
        </span>
      )
    }
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
        Step 3
      </span>
    )
  }

  const getStepDescription = (step?: 2 | 3, description?: string) => {
    if (description) return description
    if (!step) return "페이지 생성됨 - 기본 구조만 존재"
    if (step === 2) return "UI 구현 완료 - 하드코딩 데이터 사용 중"
    return "API 연동 완료 - 실제 데이터 연동됨"
  }

  const totalPages = sitemapData.reduce((acc, cat) => acc + cat.pages.length, 0)

  // 페이지 생성 (체크된 페이지)
  const pagesCreated = sitemapData.reduce(
    (acc, cat) => acc + cat.pages.filter((p) => p.isChecked).length,
    0
  )

  // UI 구현 완료 (Step 2 이상)
  const uiCompletedPages = sitemapData.reduce(
    (acc, cat) => acc + cat.pages.filter((p) => p.step && p.step >= 2).length,
    0
  )

  // API 연동 완료 (Step 3)
  const apiConnectedPages = sitemapData.reduce(
    (acc, cat) => acc + cat.pages.filter((p) => p.step === 3).length,
    0
  )

  const pageCreationRate = (pagesCreated / totalPages) * 100
  const uiCompletionRate = (uiCompletedPages / totalPages) * 100
  const apiConnectionRate = (apiConnectedPages / totalPages) * 100

  return (
    <div className="bg-linear-to-br from-gray-50 to-gray-100 px-4 py-8 sm:px-6 md:min-h-screen lg:px-8">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-6 rounded-2xl bg-white p-5 shadow-xl md:mb-8 md:p-8">
          <h1 className="mb-2 text-2xl font-bold text-gray-900 md:text-4xl">
            🗺️ 사이트맵
          </h1>
          <p className="mb-4 text-sm text-gray-600 md:mb-6 md:text-lg">
            MVP 출시를 위한 페이지 구축 현황
          </p>

          {/* Progress Stats */}
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
            <div className="rounded-lg bg-slate-50 p-3 md:p-4">
              <div className="mb-1 text-xs font-medium text-slate-600 md:text-sm">
                전체 페이지
              </div>
              <div className="text-2xl font-bold text-slate-900 md:text-3xl">
                {totalPages}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 md:text-xs">
                목표
              </div>
            </div>
            <div className="rounded-lg bg-blue-50 p-3 md:p-4">
              <div className="mb-1 text-xs font-medium text-blue-600 md:text-sm">
                페이지 생성률
              </div>
              <div className="text-2xl font-bold text-blue-900 md:text-3xl">
                {pagesCreated}
                <span className="ml-1 text-base text-blue-600 md:ml-2 md:text-lg">
                  ({pageCreationRate.toFixed(0)}%)
                </span>
              </div>
              <div className="mt-1 text-[10px] text-blue-600 md:text-xs">
                Step 1 이상
              </div>
            </div>
            <div className="rounded-lg bg-amber-50 p-3 md:p-4">
              <div className="mb-1 text-xs font-medium text-amber-600 md:text-sm">
                UI 구현률
              </div>
              <div className="text-2xl font-bold text-amber-900 md:text-3xl">
                {uiCompletedPages}
                <span className="ml-1 text-base text-amber-600 md:ml-2 md:text-lg">
                  ({uiCompletionRate.toFixed(0)}%)
                </span>
              </div>
              <div className="mt-1 text-[10px] text-amber-600 md:text-xs">
                Step 2 이상
              </div>
            </div>
            <div className="rounded-lg bg-green-50 p-3 md:p-4">
              <div className="mb-1 text-xs font-medium text-green-600 md:text-sm">
                API 연동률
              </div>
              <div className="text-2xl font-bold text-green-900 md:text-3xl">
                {apiConnectedPages}
                <span className="ml-1 text-base text-green-600 md:ml-2 md:text-lg">
                  ({apiConnectionRate.toFixed(0)}%)
                </span>
              </div>
              <div className="mt-1 text-[10px] text-green-600 md:text-xs">
                Step 3 완료
              </div>
            </div>
          </div>

          {/* Progress Bars */}
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium text-gray-700">
                  📄 페이지 생성률
                </span>
                <span className="font-semibold text-blue-700">
                  {pageCreationRate.toFixed(1)}%
                </span>
              </div>
              <div className="h-3 w-full rounded-full bg-gray-200">
                <div
                  className="h-3 rounded-full bg-linear-to-r from-blue-400 to-blue-600 transition-all duration-500"
                  style={{ width: `${pageCreationRate}%` }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium text-gray-700">🎨 UI 구현률</span>
                <span className="font-semibold text-amber-700">
                  {uiCompletionRate.toFixed(1)}%
                </span>
              </div>
              <div className="h-3 w-full rounded-full bg-gray-200">
                <div
                  className="h-3 rounded-full bg-linear-to-r from-amber-400 to-amber-600 transition-all duration-500"
                  style={{ width: `${uiCompletionRate}%` }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium text-gray-700">🔌 API 연동률</span>
                <span className="font-semibold text-green-700">
                  {apiConnectionRate.toFixed(1)}%
                </span>
              </div>
              <div className="h-3 w-full rounded-full bg-gray-200">
                <div
                  className="h-3 rounded-full bg-linear-to-r from-green-400 to-green-600 transition-all duration-500"
                  style={{ width: `${apiConnectionRate}%` }}
                />
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="mt-6 border-t border-gray-200 pt-6">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              📊 단계별 설명
            </h3>
            <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-3 md:text-sm">
              <div className="flex items-start rounded-lg bg-gray-50 p-3">
                <span className="mt-0.5 mr-2 inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800">
                  Step 1
                </span>
                <span className="text-gray-600">
                  페이지 생성 - 기본 구조만 존재
                </span>
              </div>
              <div className="flex items-start rounded-lg bg-amber-50 p-3">
                <span className="mt-0.5 mr-2 inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  Step 2
                </span>
                <span className="text-gray-600">
                  UI 구현 - 하드코딩 데이터 사용
                </span>
              </div>
              <div className="flex items-start rounded-lg bg-green-50 p-3">
                <span className="mt-0.5 mr-2 inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                  Step 3
                </span>
                <span className="text-gray-600">완료 - API 연동 완료</span>
              </div>
            </div>
          </div>
        </div>

        {/* Categories */}
        <div className="space-y-6">
          {sitemapData.map((category, categoryIndex) => (
            <div
              key={category.category}
              className="overflow-hidden rounded-xl bg-white shadow-lg"
            >
              <div className="bg-linear-to-r from-indigo-500 to-purple-600 px-6 py-4">
                <h2 className="text-xl font-bold text-white">
                  {category.category}
                </h2>
                <p className="text-sm text-indigo-100">
                  {category.pages.filter((p) => p.isChecked).length} /{" "}
                  {category.pages.length} 페이지 구현 중
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 md:gap-5 md:p-6">
                {category.pages.map((page, pageIndex) => (
                  <div
                    key={page.id}
                    className="rounded-lg border border-gray-200 bg-white p-4 transition-all duration-150 hover:border-indigo-300 hover:shadow-md"
                  >
                    <div className="flex items-start gap-3">
                      {/* Checkbox */}
                      <div className="shrink-0 pt-1">
                        <input
                          type="checkbox"
                          checked={page.isChecked}
                          onChange={() => toggleCheck(categoryIndex, pageIndex)}
                          className="h-5 w-5 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <Link
                            href={page.path}
                            className="text-base font-semibold text-gray-900 transition-colors hover:text-indigo-600 md:text-lg"
                          >
                            {page.title}
                          </Link>
                          {getStepBadge(page.step)}
                        </div>

                        <Link
                          href={page.path}
                          className="mb-2 block font-mono text-xs break-all text-indigo-600 hover:text-indigo-800 md:text-sm"
                        >
                          {page.path} →
                        </Link>

                        <p className="text-xs text-gray-600 md:text-sm">
                          {getStepDescription(page.step, page.description)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-8 rounded-xl bg-white p-6 text-center shadow-lg">
          <p className="text-gray-600">
            🚀 <strong>화이팅!</strong> MVP 출시를 향해 달려가고 있습니다
          </p>
        </div>
      </div>
    </div>
  )
}
