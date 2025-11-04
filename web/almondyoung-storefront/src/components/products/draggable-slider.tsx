import { BasicProductCard } from "@components/products/product-card"
import React, { useState, useRef, ReactNode, MouseEvent } from "react"

// 컴포넌트의 props 타입을 정의합니다.
interface DraggableSliderProps {
  title: string
  children?: ReactNode // 슬라이더에 들어갈 아이템들
}

// BasicProductCard에 맞는 예시 데이터
const recommendedProducts = [
  {
    id: "1",
    image:
      "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg", // 이미지 색상 조정
    thumbnail:
      "https://almondyoung.com/web/product/medium/202503/d21d85aa58f14bb4cc2a69342d24c4fa.jpg",
    name: "포스아이래쉬 여우펌 콜라겐 케라틴 파우더 10g",
    price: {
      original: 30000,
      member: 5000,
      discountRate: 83,
      isMembership: false
    },
    membershipPrice: 5000,
    discountRate: 78,
    rating: 4.5,
    reviewCount: 401,
    isSoldOut: false,
    hasOptions: true,
  },
  {
    id: "2",
    image:
      "https://almondyoung.com/web/product/medium/202402/9b57c6aa76f40052f31f2ea85c6876a7.jpg", // 이미지 색상 조정
    thumbnail:
      "https://almondyoung.com/web/product/medium/202402/9b57c6aa76f40052f31f2ea85c6876a7.jpg",
    name: "반하다 알록달록 무쌍 레인보우 롯드 LU컬",
    price: {
      original: 30000,
      member: 28000,
      discountRate: 7,
      isMembership: false
    },
    membershipPrice: 28000, // 멤버십 가격 추가
    discountRate: 78,
    rating: 5,
    reviewCount: 401,
    isSoldOut: false,
    isSingleOption: true,
    shipmentInfo: "무료배송",
  },
  {
    id: "3",
    image:
      "https://almondyoung.com/web/product/medium/202508/f78ca31bb7f7c9cb0461ba7bc24145dc.png", // 이미지 색상 조정
    thumbnail:
      "https://almondyoung.com/web/product/medium/202508/f78ca31bb7f7c9cb0461ba7bc24145dc.png",
    name: "반하다 바싹펌",
    price: {
      original: 30000,
      member: 15000,
      discountRate: 50,
      isMembership: false
    },
    membershipPrice: 15000, // 멤버십 가격
    discountRate: 78,
    isSoldOut: false, // 품절 아님으로 변경
    rating: 3.8,
    reviewCount: 288, // 리뷰 수 조정
  },
  {
    // 추가 상품 (슬라이드 테스트용)
    id: "4",
    image:
      "https://almondyoung.com/web/product/medium/202508/c3a909e285d10ac83233c8dcc4e361f8.jpg", // 이미지 색상 조정
    thumbnail:
      "https://almondyoung.com/web/product/medium/202508/c3a909e285d10ac83233c8dcc4e361f8.jpg",
    name: "NEW 에센스 펌 세트",
    price: {
      original: 25000,
      member: 18000,
      discountRate: 28,
      isMembership: false
    },
    membershipPrice: 18000,
    discountRate: 28,
    rating: 4.2,
    reviewCount: 120,
    isSoldOut: false,
  },
]
export function DraggableSliderCards({
  title,
  children,
}: DraggableSliderProps) {
  // 슬라이더 기능에 필요한 상태와 ref만 컴포넌트 내부에 캡슐화합니다.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [startX, setStartX] = useState(0)
  const [scrollLeft, setScrollLeft] = useState(0)

  // 이벤트 핸들러에 타입을 명시적으로 지정합니다.
  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!scrollRef.current) return
    setIsDragging(true)
    setStartX(e.pageX - scrollRef.current.offsetLeft)
    setScrollLeft(scrollRef.current.scrollLeft)
  }

  const onMouseUpOrLeave = () => {
    setIsDragging(false)
  }

  const onMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !scrollRef.current) return
    e.preventDefault()
    const x = e.pageX - scrollRef.current.offsetLeft
    const walk = (x - startX) * 2 // 드래그 감도
    scrollRef.current.scrollLeft = scrollLeft - walk
  }

  return (
    <section className="mt-[10px] bg-white">
      <h3 className="mb-4 text-lg font-bold">{title}</h3>
      <div className="relative overflow-hidden rounded-xl bg-white p-4">
        <div
          ref={scrollRef}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUpOrLeave}
          onMouseLeave={onMouseUpOrLeave}
          onMouseMove={onMouseMove}
          className={`scrollbar-hide flex cursor-grab overflow-x-auto scroll-smooth pb-4 ${
            isDragging ? "cursor-grabbing" : ""
          }`}
        >
          {/* children 으로 추후바꾸길 */}
          {recommendedProducts.map((product) => (
            <div
              key={product.id}
              className="w-[40%] flex-shrink-0 pr-4 sm:w-[calc(100%/3)] md:w-[calc(100%/2.5)] lg:w-1/3"
              // 드래그 중 이미지나 텍스트 선택을 방지
              onDragStart={(e) => e.preventDefault()}
            >
              <BasicProductCard product={product} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
