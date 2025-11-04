"use client"

import React, { useState } from "react"
import { ShoppingCart, Zap } from "lucide-react"
import CartSheet from "./cart-sheet"

interface CartQuickButtonProps {
  className?: string
}

export const CartQuickButton: React.FC<CartQuickButtonProps> = ({
  className = "",
}) => {
  const [isCartOpen, setIsCartOpen] = useState(false)

  return (
    <>
      <button onClick={() => setIsCartOpen(true)} className="fixed top-1/2 right-0 z-50 -translate-y-1/2 md:hidden" aria-label="장바구니 열기">
        {/* 퀵탭 컨테이너 - 반투명 흰색 배경 */}
        <div className="relative h-[83px] w-[38px] rounded-l-[10px] bg-white/80 shadow-[-3px_2px_5px_rgba(0,0,0,0.25)] backdrop-blur-sm">
          {/* 장바구니 아이콘 그룹 */}
          <div className="absolute top-[35px] left-[6px] h-[22px] w-[22px]">
            {/* 장바구니 아이콘 */}
            <ShoppingCart
              className="h-[22px] w-[22px] text-[#1E1E1E]"
              strokeWidth={1.6}
              fill="none"
            />

            {/* 번개 아이콘 - 장바구니 안에 위치 */}
            <Zap
              className="absolute top-[6px] left-[9px] h-[8px] w-[8px] text-[#1E1E1E]"
              fill="#1E1E1E"
              strokeWidth={0}
            />
          </div>

          {/* 알림 배지 */}
          {/* TODO: 실제 장바구니 아이템 수 연동 */}
        </div>
      </button>

      {/* 장바구니 시트 */}
      <CartSheet isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
    </>
  )
}

export default CartQuickButton
