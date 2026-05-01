import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import { ShoppingBag } from "lucide-react"

export function FrequentEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
        <ShoppingBag className="h-8 w-8 text-gray-400" />
      </div>
      <h3 className="mb-2 text-lg font-medium text-gray-900">
        자주 산 상품이 없습니다
      </h3>
      <p className="mb-6 text-center text-sm text-gray-500">
        구매 내역이 쌓이면 자주 산 상품이 여기에 표시됩니다
      </p>
      <LocalizedClientLink href="/categories">
        <Button variant="outline">쇼핑하러 가기</Button>
      </LocalizedClientLink>
    </div>
  )
}
