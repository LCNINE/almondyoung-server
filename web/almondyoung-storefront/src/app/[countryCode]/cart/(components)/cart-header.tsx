import React from "react"
import { ChevronRight } from "lucide-react"

export function CartHeader() {
  return (
    <div className="hidden md:block">
      <div className="flex items-center gap-8 py-10">
        <h1 className="text-2xl font-bold">장바구니</h1>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">주문/결제</span>
            <ChevronRight className="h-4 w-4" />
          </div>
          <span className="text-gray-500">완료</span>
        </div>
      </div>
    </div>
  )
}

