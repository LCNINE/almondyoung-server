"use client"

import { useState, useMemo } from "react"
import { FilterOptions, Order, OrderStatus } from "../types/order-list-types"

const MOCK_ORDERS: Order[] = [
  {
    id: "order-1",
    date: "2025. 5. 14 주문",
    status: "preparing" as OrderStatus,
    guaranteeLabel: "당일 출고 보장",
    isSeparateDelivery: true,
    products: [
      {
        id: 1,
        image: "https://via.placeholder.com/80",
        title: "노몬드 속눈썹 영양제 블랙",
        price: "9,000원",
        quantity: "2개",
        options: ["브러쉬 타입 1개", "마스카라 타입 1개"],
      },
    ],
  },
  {
    id: "order-2",
    date: "2025. 5. 10 주문",
    status: "completed" as OrderStatus,
    deliveryDate: "5/12(월) 도착",
    isSeparateDelivery: true,
    products: [
      {
        id: 2,
        image: "https://via.placeholder.com/80",
        title: "오샤레 킹 파우더 3.4g 점도 조절제",
        price: "10,000원",
        quantity: "1개",
      },
    ],
  },
  {
    id: "order-3",
    date: "2025. 5. 10 주문",
    status: "shipping" as OrderStatus,
    deliveryDate: "5/14(수) 도착예정",
    isSeparateDelivery: true,
    products: [
      {
        id: 3,
        image: "https://via.placeholder.com/80",
        title: "오샤레 킹 파우더 3.4g 점도 조절제",
        price: "10,000원",
        quantity: "1개",
      },
    ],
  },
  {
    id: "order-4",
    date: "2025. 4. 30 주문",
    status: "completed" as OrderStatus,
    deliveryDate: "5/2(금) 도착",
    isSeparateDelivery: true,
    products: [
      {
        id: 4,
        image: "https://via.placeholder.com/80",
        title: "RUBBERPLUS 러버플러스 글러브 100매",
        price: "5,900원",
        quantity: "2개",
        options: ["XS"],
      },
      {
        id: 5,
        image: "https://via.placeholder.com/80",
        title: "래쉬몬스터 네일 레쥬 살롱 5.5 100ml",
        price: "9,000원",
        quantity: "2개",
        options: ["브러쉬 타입 1개", "마스카라 타입 1개"],
      },
      {
        id: 6,
        image: "https://via.placeholder.com/80",
        title: "티나 컬링 릿드 래쉬컬 디폴 UNDER컬 3종",
        price: "20,000원",
        quantity: "2개",
      },
    ],
  },
]

export function useOrderList() {
  const [searchQuery, setSearchQuery] = useState("")
  const [filters, setFilters] = useState<FilterOptions>({
    year: "전체년도",
    month: "월",
  })

  // 필터링된 주문 목록
  const filteredOrders = useMemo(() => {
    let filtered = MOCK_ORDERS

    // 검색어 필터링
    if (searchQuery.trim()) {
      filtered = filtered.filter((order) =>
        order.products.some((product) =>
          product.title.toLowerCase().includes(searchQuery.toLowerCase())
        )
      )
    }

    // 년도 필터링
    if (filters.year !== "전체년도") {
      filtered = filtered.filter((order) => order.date.includes(filters.year))
    }

    // 월 필터링
    if (filters.month !== "월") {
      const monthNumber = filters.month.replace("월", "")
      filtered = filtered.filter(
        (order) =>
          order.date.includes(`. ${monthNumber}.`) ||
          order.date.includes(`. ${monthNumber} `)
      )
    }

    return filtered
  }, [searchQuery, filters])

  // 검색어 변경 핸들러
  const handleSearchChange = (query: string) => {
    setSearchQuery(query)
  }

  // 필터 변경 핸들러
  const handleFilterChange = (newFilters: FilterOptions) => {
    setFilters(newFilters)
  }

  // 주문 더보기 핸들러
  const handleMoreClick = (orderId: string) => {
    console.log("더보기:", orderId)
    // TODO: 주문 상세 페이지로 이동 또는 모달 표시
  }

  return {
    orders: filteredOrders,
    searchQuery,
    filters,
    handleSearchChange,
    handleFilterChange,
    handleMoreClick,
  }
}
