import React from "react"
import { ChevronRight } from "lucide-react"

export function CartHeader() {
  return (
    <div className="hidden md:block">
      <div className="flex items-center justify-between py-10">
        <h1 className="text-4xl font-bold">장바구니</h1>
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold">주문/결제</span>
          <ChevronRight className="h-6 w-6 text-border" />
          <span className="text-xl font-normal text-muted-foreground">
            완료
          </span>
        </div>
      </div>
    </div>
  )
}
