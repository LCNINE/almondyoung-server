"use client"

type ProductStockAlertProps = {
  stock: number
  className?: string
}

export const ProductStockAlert = ({
  stock,
  className = "",
}: ProductStockAlertProps) => {
  if (!Number.isFinite(stock) || stock < 1) return null

  return (
    <span
      className={`inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 ${className}`}
    >
      재고 {stock}개 남음
    </span>
  )
}
