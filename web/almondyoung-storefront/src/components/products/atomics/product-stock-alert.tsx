"use client"

import React from "react"
import { AlertCircle } from "lucide-react"

export const ProductStockAlert = ({ stock }: { stock?: number | null }) =>
  stock ? (
    <div className="flex items-center gap-0.75 text-red-500">
      <AlertCircle className="h-3.5 w-3.5" />
      <span className="text-xs font-medium md:text-sm">잔여수량 {stock}개</span>
    </div>
  ) : null
