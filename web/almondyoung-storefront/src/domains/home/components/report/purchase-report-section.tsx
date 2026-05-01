"use client"

import React, { useState, useEffect } from "react"
import { X, Calendar } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

interface Report {
  id: number
  type: "reorder" | "lowStock" | "review"
  title: string
  message: string
  date?: string
  color?: string
  products?: Array<{
    id: number
    image: string
    stock?: number
    name: string
  }>
  reviewProduct?: {
    image: string
    name: string
    price: string
  }
}

const PurchaseReportDashboard = () => {
  const [reports, setReports] = useState<Report[]>([])

  useEffect(() => {
    // API 데이터 시뮬레이션
    const mockReports: Report[] = [
      {
        id: 1,
        type: "reorder",
        title: "재료 주문 알림",
        message:
          "아래 제품 재고확인이 필요할것 같아요.\n샵에 남은 재고를 확인해보고 늦지않게 재료주문 하세요.",
        date: "2025-04-23",
        color: "#F29219",
        products: [
          {
            id: 1,
            image:
              "https://almondyoung.com/web/product/medium/202507/02b0c015f5679ccd844313f4b19d4cd6.jpg",
            stock: 4,
            name: "에스프레소 원두",
          },
          {
            id: 2,
            image:
              "https://almondyoung.com/web/product/medium/202506/e5c04562be2ca5145a1643b0fafdeff9.jpg",
            stock: 2,
            name: "디카페인 캡슐",
          },
          {
            id: 3,
            image:
              "https://almondyoung.com/web/product/medium/202506/4e89d19891ac4d9f144c9c7bb0328e00.jpg",
            stock: 2,
            name: "콜드브루 원액",
          },
        ],
      },
      {
        id: 2,
        type: "lowStock",
        title: "품절 임박",
        message: "자주 사는 제품 중 품절 임박 제품을 미리 확인하세요.",
        products: [
          {
            id: 4,
            image:
              "https://almondyoung.com/web/product/medium/202508/889a6edcc3d319f07b237c508b6902e2.jpg",
            stock: 4,
            name: "필터 페이퍼",
          },
          {
            id: 5,
            image:
              "https://almondyoung.com/web/product/medium/202504/9a0caabf2af8b51a1a3d3bfe656b8c09.jpg",
            stock: 2,
            name: "청소용 브러시",
          },
          {
            id: 6,
            image:
              "https://almondyoung.com/web/product/medium/202503/4e7e1f29266bd72280d6129678d5fd4d.jpg",
            stock: 2,
            name: "우유 거품기",
          },
        ],
      },
      {
        id: 3,
        type: "review",
        title: "리뷰 적립금",
        message: "지난번 구매한 제품 어떠셨나요?",
        date: "2025-04-23",
        reviewProduct: {
          image:
            "https://almondyoung.com/web/product/medium/202502/8f22941f61de5b91ec5a904026c6ec12.jpg",
          name: "핸드드립 세트",
          price: "85,000원",
        },
      },
    ]

    setReports(mockReports)
  }, [])

  if (reports.length === 0) {
    return (
      <div className="border-gray-20 bg-background w-full rounded-2xl border md:mt-10 lg:mt-0 lg:min-h-screen lg:max-w-[406px]">
        <div className="flex items-start justify-between p-5">
          <div className="space-y-2">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <div className="space-y-4 px-5 pb-5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={`report-skeleton-${index}`} className="rounded-b-xl">
              <div className="border-gray-80 bg-background flex items-center gap-3 rounded-xl border p-4 shadow-md">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <div className="rounded-b-xl border-x border-b border-gray-200 p-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="mt-2 h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="border-gray-20 bg-background w-full rounded-2xl border md:mt-10 lg:mt-0 lg:min-h-screen lg:max-w-[406px]">
      {/* Header */}
      <div className="flex items-start justify-between p-5">
        <div>
          <h1 className="mb-2 text-lg font-bold">구매 리포트</h1>
          <p className="text-sm opacity-50">AI 활용 추천</p>
        </div>
      </div>

      {/* Content */}
      <div className="px-5 pb-5">
        {/* Show all reports with desktop design */}
        <div className="flex flex-col gap-4">
          {reports.map((report) => (
            <div key={report.id} className="bg-muted rounded-b-xl">
              {/* 카드 헤더 */}
              <div className="border-gray-80 bg-background flex items-center justify-between rounded-xl border p-4 shadow-md">
                <div className="flex items-center gap-3">
                  <div className="bg-accent flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white">
                    {report.id}
                  </div>
                  <div className="text-foreground text-[16px] font-semibold">
                    {report.title}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-purple-100 px-2 py-1 text-xs text-purple-600">
                    {report.type === "reorder"
                      ? "재주문"
                      : report.type === "lowStock"
                        ? "품절임박"
                        : "리뷰"}
                  </span>
                  <X size={16} className="text-gray-40 cursor-pointer" />
                </div>
              </div>

              {/* 카드 내용 */}
              <div className="p-4">
                {report.type === "reorder" && (
                  <div className="space-y-4">
                    {/* 사용자 리뷰 */}
                    <div className="flex-1">
                      <p className="text-gray-70 mb-2 text-[14px] leading-relaxed">
                        {report.message}
                      </p>
                      <div className="flex items-center gap-1 text-[12px] text-gray-50">
                        <Calendar size={14} className="text-purple-500" />{" "}
                        <span className="text-purple-500">
                          지난구매일 : {report.date}
                        </span>
                      </div>
                    </div>

                    {/* 상품 이미지 갤러리 */}
                    <div className="flex gap-3 overflow-x-auto pb-2">
                      {report.products?.map((product, productIndex) => (
                        <div
                          key={product.id}
                          className="relative flex-shrink-0"
                        >
                          <div className="h-24 w-24 overflow-hidden rounded-lg border border-gray-200">
                            <img
                              src={product.image}
                              alt={product.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="text-foreground absolute top-1 right-1 rounded bg-blue-500 px-1 py-0.5 text-[10px]">
                            공식
                          </div>
                          <div className="bg-foreground/80 absolute bottom-1 left-1 rounded px-1 py-0.5 text-[10px] text-gray-600">
                            {product.stock ||
                              Math.floor(Math.random() * 50) + 10}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {report.type === "lowStock" && (
                  <div className="space-y-4">
                    <p className="text-[14px] text-gray-700">
                      {report.message}
                    </p>
                    <div className="flex gap-3 overflow-x-auto pb-2">
                      {report.products?.map((product) => (
                        <div
                          key={product.id}
                          className="relative flex-shrink-0"
                        >
                          <div className="h-24 w-24 overflow-hidden rounded-lg border border-red-200">
                            <img
                              src={product.image}
                              alt={product.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="absolute top-1 right-1 rounded bg-red-500 px-1 py-0.5 text-[10px] text-white">
                            품절임박
                          </div>
                          <div className="absolute bottom-1 left-1 rounded bg-white/80 px-1 py-0.5 text-[10px] text-red-600">
                            잔여 {product.stock}개
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {report.type === "review" && (
                  <div className="space-y-4">
                    <p className="text-[14px] text-gray-700">
                      {report.message}
                    </p>
                    <div className="flex gap-3 overflow-x-auto pb-2">
                      {report.reviewProduct && (
                        <div className="relative flex-shrink-0">
                          <div className="h-24 w-24 overflow-hidden rounded-lg border border-gray-200">
                            <img
                              src={report.reviewProduct.image}
                              alt={report.reviewProduct.name}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="absolute top-1 right-1 rounded bg-green-500 px-1 py-0.5 text-[10px] text-white">
                            리뷰
                          </div>
                          <div className="absolute bottom-1 left-1 rounded bg-white/80 px-1 py-0.5 text-[10px] text-gray-600">
                            {report.reviewProduct.price}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default PurchaseReportDashboard
