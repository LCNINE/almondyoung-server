import { cn } from "@lib/utils"
import { formatPrice } from "@/lib/utils/price-utils"

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
      <div className={cn("text-sm sm:text-base", className)}>
        {formatPrice(amount)}
      </div>
      <span className={cn("text-sm sm:text-base", unitClassName)}>원</span>
    </div>
  )
}
