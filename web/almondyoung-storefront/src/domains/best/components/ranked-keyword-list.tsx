"use client"

import React, { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, ChevronRight, TrendingUp, Minus } from "lucide-react"
import BasicProductCard from "@components/products/product-card"
import { v4 as uuidv4 } from "uuid"
// 서버 데이터 구조를 그대로 사용
export interface Product {
  id: string
  name: string
  thumbnail: string
  basePrice?: number
  membershipPrice: number
  isMembershipOnly?: boolean
  status?: string // 옵셔널: status가 없으면 active로 간주
  optionMeta?: {
    isSingle?: boolean
  }
  defaultSku?: number
  stock?: {
    available?: number
  }
  rating?: number
  reviewCount?: number
}

export interface Keyword {
  rank: number
  name: string
  category: string
  trend: "up" | "down" | "stable"
  products?: Product[]
}

interface RankedKeywordListProps {
  keywords: Keyword[]
}

export default function RankedKeywordList({
  keywords,
}: RankedKeywordListProps) {
  const router = useRouter()
  const [expandedKeywords, setExpandedKeywords] = useState<
    Record<number, boolean>
  >({ 1: true })
  const [showMore, setShowMore] = useState(false)

  const toggleKeyword = (rank: number) => {
    setExpandedKeywords((prev) => ({
      ...prev,
      [rank]: !prev[rank],
    }))
  }

  return (
    <>
      <ol className="space-y-4">
        {keywords.slice(0, showMore ? 10 : 5).map((keyword) => (
          <li key={uuidv4()} className="overflow-hidden rounded-lg border">
            <header>
              <button
                onClick={() => toggleKeyword(keyword.rank)}
                className="flex w-full items-center justify-between px-10 py-4 hover:cursor-pointer"
                aria-expanded={expandedKeywords[keyword.rank]}
                aria-controls={`keyword-products-${keyword.rank}`}
              >
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-2xl font-bold"
                      aria-label={`${keyword.rank}위`}
                    >
                      {keyword.rank}
                    </span>
                    {keyword.trend === "up" && (
                      <TrendingUp
                        className="h-4 w-4 text-red-500"
                        aria-label="순위 상승"
                      />
                    )}
                    {keyword.trend === "down" && (
                      <TrendingUp
                        className="h-4 w-4 rotate-180 text-blue-500"
                        aria-label="순위 하락"
                      />
                    )}
                    {keyword.trend === "stable" && (
                      <Minus
                        className="h-4 w-4 text-gray-400"
                        aria-label="순위 유지"
                      />
                    )}
                  </div>
                  <h3 className="text-lg font-semibold">{keyword.name}</h3>
                  <span className="text-sm text-gray-500">
                    {keyword.category}
                  </span>
                </div>
                <ChevronDown
                  className={`h-5 w-5 transition-transform ${expandedKeywords[keyword.rank] ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
              </button>
            </header>

            {/* Expanded Products */}
            {expandedKeywords[keyword.rank] && keyword.products && (
              <section
                id={`keyword-products-${keyword.rank}`}
                className="border-t px-10 py-4"
                aria-label={`${keyword.name} 관련 상품`}
              >
                <ul className="scrollbar-hide flex gap-2 overflow-x-auto pb-2 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible lg:grid-cols-5 lg:gap-6">
                  {keyword.products.map((product) => (
                    <li
                      key={product.id}
                      className="w-[150px] flex-shrink-0 md:w-auto"
                    >
                      <BasicProductCard product={product} />
                    </li>
                  ))}
                </ul>
                <nav className="mt-4 mb-10">
                  <button
                    className="flex w-fit items-center justify-center gap-1 rounded-full border border-gray-300 px-8 py-3 text-sm text-gray-600 transition-colors hover:bg-gray-50"
                    onClick={() =>
                      router.push(`/search?keyword=${keyword.name}`)
                    }
                    aria-label={`${keyword.name} 상품 더보기`}
                  >
                    <span>상품 더보러가기</span>
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </nav>
              </section>
            )}
          </li>
        ))}
      </ol>

      {/* Show More Button */}
      {!showMore && (
        <button
          onClick={() => setShowMore(true)}
          className="mt-4 flex w-full items-center justify-center gap-1 py-3 text-center text-gray-600 hover:text-gray-800"
        >
          <span className="font-medium">6위~10위</span> 더보기
          <ChevronDown className="h-4 w-4" />
        </button>
      )}
    </>
  )
}
