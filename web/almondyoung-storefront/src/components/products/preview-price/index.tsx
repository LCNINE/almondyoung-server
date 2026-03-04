import { VariantPrice } from "@/lib/types/common/price"
import { cn } from "@/lib/utils"

export default async function PreviewPrice({ price }: { price: VariantPrice }) {
  if (!price) {
    return null
  }
  return (
    <>
      {price.price_type === "sale" && <>{price.original_price}</>}
      <div
        className={cn("text-ui-fg-muted", {
          "text-ui-fg-interactive": price.price_type === "sale",
        })}
        data-testid="price"
      >
        {price.calculated_price}
      </div>
    </>
  )
}
