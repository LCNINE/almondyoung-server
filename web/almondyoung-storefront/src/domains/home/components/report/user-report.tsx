import {
  ChevronLeft,
  ChevronRight,
  ShoppingCart,
  Star,
  Triangle,
  X,
} from "lucide-react"
import React from "react"
import Image from "next/image"
import { LowStockBadge } from "@/components/shared/badges/low-stock-badge"

// --- 1. 데이터 분리 ---
const recommendedProducts = [
  { id: 1, src: "https://placehold.co/100x100" },
  { id: 2, src: "https://placehold.co/100x100" },
  { id: 3, src: "https://placehold.co/100x100" },
]
const lowStockItems = [
  { id: 1, src: "https://placehold.co/100x100", stock: 4 },
  { id: 2, src: "https://placehold.co/100x100", stock: 2 },
  { id: 3, src: "https://placehold.co/100x100", stock: 2 },
]
const reviewItem = {
  id: 1,
  src: "https://placehold.co/80x80", // 80x80 사이즈
}

// --- 유저 리포트 새로 만든것 ---
export default function UserReport() {
  const triangleFillColor = "#f4f4f4"
  const triangleWhiteFillColor = "#ffffff"
  const starFillColor = "#C6C6C6"

  return (
    <article className="flex flex-col self-stretch overflow-hidden rounded-[15px] bg-[#f4f4f4]">
      {/* 1. HEADER */}
      <header className="flex items-start justify-between self-stretch bg-[#f29219] p-5">
        <div className="flex flex-col items-start gap-[9px]">
          <h2 className="text-lg font-bold text-white">
            이유진 원장님 구매 리포트
          </h2>
          <p className="text-sm text-[#f4f4f4] opacity-50">Ai 활용 추천</p>
        </div>
        <div className="flex items-center gap-1" aria-label="페이지네이션">
          <span
            className="flex h-4 w-4 items-center justify-center rounded-full bg-[#2C2C2E] text-[11px] font-bold text-white"
            aria-current="page"
          >
            1
          </span>
          <span className="flex h-4 w-4 items-center justify-center text-[11px] font-bold text-[#2c2c2e]">
            2
          </span>
        </div>
      </header>

      {/* 2. BODY CONTENT */}
      <div className="flex flex-col items-start gap-[30px] self-stretch p-5">
        {/* 2-1. 추천 제품 (가로 스크롤) */}
        <div className="scrollbar-hide -mx-5 flex items-start gap-2.5 self-stretch overflow-x-auto px-5">
          {recommendedProducts.map((product) => (
            <div
              key={product.id}
              className="relative h-[100px] w-[100px] shrink-0"
            >
              <Image
                src={product.src}
                alt="추천 제품"
                width={100}
                height={100}
                className="h-full w-full rounded-[10px] border border-[#e9e9e9] object-cover"
                unoptimized={true} // [수정] SVG 오류 해결
              />
              <button
                type="button"
                aria-label="장바구니에 담기"
                className="absolute right-2 bottom-2 flex h-6 w-6 items-center justify-center rounded-full border-[0.5px] border-[#E5DFDF] bg-white/50 backdrop-blur-sm"
              >
                <ShoppingCart
                  className="h-4 w-4 text-[#C6C6C6]"
                  strokeWidth={1.5}
                />
              </button>
            </div>
          ))}
        </div>

        {/* 2-2. 주문 알림 (말풍선) */}
        <div className="flex flex-col items-start self-stretch">
          <Triangle
            className="text-[#f4f4f4]"
            fill={triangleFillColor}
            size={16}
            style={{ marginLeft: "20px", marginBottom: "-1px" }}
          />
          <div className="flex flex-col self-stretch rounded-[10px] bg-white p-[18px]">
            <div className="flex items-start justify-between self-stretch">
              <div className="flex flex-col items-start gap-[9px]">
                <span className="rounded-[3px] bg-[#f4f4f4] px-1 py-0.5 text-[10px] text-[#f29219]">
                  재료 주문 알림
                </span>
                <p className="text-sm">
                  아래 제품 재고확인이 필요할것 같아요.
                  <br />
                  샵에 남은 재고를 확인해보고 늦지않게 재료주문 하세요.
                  <br />
                  <span className="text-[#636366]">지난주문 : 2025-04-23</span>
                </p>
              </div>
              <button
                type="button"
                aria-label="알림 닫기"
                className="-m-1 p-1 text-[#AEAEB2]"
              >
                <X size={20} strokeWidth={2} />
              </button>
            </div>
          </div>
          <Triangle
            className="text-white"
            fill={triangleWhiteFillColor}
            size={16}
            style={{ marginLeft: "40px", marginTop: "-1px" }}
          />
        </div>

        {/* 2-3. 품절 임박 (가로 스크롤) */}
        <div className="flex flex-col items-start gap-[15px] self-stretch">
          <div className="scrollbar-hide -mx-5 flex items-start gap-2.5 overflow-x-auto px-5">
            {lowStockItems.map((item) => (
              <div
                key={item.id}
                className="flex w-[100px] shrink-0 flex-col gap-[7px]"
              >
                <Image
                  src={item.src}
                  alt="품절 임박 제품"
                  width={100}
                  height={100}
                  className="h-[100px] w-[100px] rounded-[10px] object-cover"
                  unoptimized={true} // [수정] SVG 오류 해결
                />
                <LowStockBadge
                  count={item.stock}
                  size="sm"
                  color="#F54527"
                  className="font-normal"
                />
              </div>
            ))}
          </div>
          <div className="flex items-start justify-between self-stretch rounded-[10px] bg-white p-[18px]">
            <div className="flex flex-col items-start gap-[9px]">
              <span className="rounded-[3px] bg-[#f4f4f4] px-1 py-0.5 text-[10px] text-[#f54527]">
                품절 임박
              </span>
              <p className="text-sm text-black">
                자주 사는 제품 중 품절 임박 제품을 미리 확인하세요.
              </p>
            </div>
            <button
              type="button"
              aria-label="알림 닫기"
              className="-m-1 p-1 text-[#C6C6C6]"
            >
              <X size={20} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* 2-4. 리뷰 적립금 */}
        <div className="flex flex-col gap-3.5 self-stretch rounded-[10px] bg-white p-[18px]">
          <div className="flex items-start justify-between self-stretch">
            <div className="flex flex-col items-start gap-1">
              <span className="rounded-[3px] bg-[#f4f4f4] px-1 py-0.5 text-[10px] text-[#f29219]">
                리뷰 적립금
              </span>
              <p className="text-sm">
                <span className="text-black">
                  지난번 구매한 제품 어떠셨나요?
                </span>
                <br />
                <span className="text-[#636366]">주문일 : 2025-04-23</span>
              </p>
            </div>
            <button
              type="button"
              aria-label="알림 닫기"
              className="-m-1 p-1 text-[#C6C6C6]"
            >
              <X size={20} strokeWidth={2} />
            </button>
          </div>

          <hr className="w-full border-t border-[#F4F4F4]" />

          <div className="flex flex-col items-start gap-[17px] self-stretch">
            <div className="flex items-start gap-3.5 self-stretch">
              <Image
                src={reviewItem.src}
                alt="리뷰할 제품"
                width={80}
                height={80}
                className="h-20 w-20 shrink-0 rounded-[5px] object-cover"
                unoptimized={true} // [수정] SVG 오류 해결 (80x80)
              />
              <div className="flex flex-col items-start gap-2.5">
                <p className="text-sm">
                  <span className="text-black">
                    15초만에 리뷰를 남겨보세요!
                  </span>
                  <br />
                  <span className="text-black">(적립금 50원)</span>
                  <br />
                  <span className="text-[#8e8e93]">
                    포토 리뷰 작성시 150원 적립
                  </span>
                </p>
                <div className="flex items-center gap-px" aria-label="별점 0점">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      className="text-[#C6C6C6]"
                      fill={starFillColor}
                      size={24}
                    />
                  ))}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="flex h-9 w-full items-center justify-center rounded-[3px] bg-[#f29219] p-2.5"
            >
              <p className="text-center text-[11px] text-white">
                리뷰 남기고 적립금 받기
              </p>
            </button>
          </div>
        </div>
      </div>

      {/* 3. FOOTER (Carousel Arrows) */}
      <footer
        className="flex items-center justify-center gap-2.5 py-5"
        style={{ filter: "drop-shadow(0px 4px 4px rgba(0,0,0,0.1))" }}
      >
        <button
          type="button"
          aria-label="이전"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white pr-0.5 shadow-md"
        >
          <ChevronLeft className="h-6 w-6 text-[#1E1E1E]" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          aria-label="다음"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white pl-0.5 shadow-md"
        >
          <ChevronRight className="h-6 w-6 text-[#1E1E1E]" strokeWidth={1.5} />
        </button>
      </footer>
    </article>
  )
}
