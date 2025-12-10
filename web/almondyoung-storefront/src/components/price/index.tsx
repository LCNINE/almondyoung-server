import { cn } from "@lib/utils"
import currency from "currency.js"

const formatNumber = (value: number | null | undefined) => {
  return currency(value || 0, {
    precision: 0,
    separator: ",",
  }).value.toLocaleString("ko-KR")
}

export function Price({
  amount,
  className,
  unitClassName,
}: {
  amount: number
  className?: string
  unitClassName?: string
}) {
  return (
    <div className="inline-flex items-baseline">
      <div className={className}>{formatNumber(amount)}</div>
      <span className={cn(unitClassName)}>원</span>
    </div>
  )
}
