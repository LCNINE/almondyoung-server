import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ShoppingCart } from "lucide-react"

export function QuickCartButton() {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        "pointer-events-none absolute right-3 bottom-3 translate-y-3 opacity-0 max-sm:hidden",
        "h-9 w-9 rounded-full border border-white/20 bg-white/70 shadow-sm backdrop-blur-md",
        "group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100",
        "transition-all duration-300 ease-out hover:scale-105 hover:bg-white/90 active:scale-95"
      )}
      onClick={(e) => {
        e.preventDefault()
        // todo: 장바구니 로직 추가
      }}
    >
      <ShoppingCart className="h-5 w-5 text-gray-800" strokeWidth={1.5} />
    </Button>
  )
}
