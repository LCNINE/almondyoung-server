import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import { Eye } from "lucide-react"

export function RecentViewsEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
        <Eye className="h-8 w-8 text-gray-400" />
      </div>
      <p className="mb-2 text-lg font-medium text-gray-900">
        최근 본 상품이 없습니다
      </p>
      <p className="mb-6 text-sm text-gray-500">
        상품을 둘러보고 나만의 취향을 찾아보세요
      </p>
      <LocalizedClientLink href="/">
        <Button variant="outline" className="h-10 px-6">
          쇼핑하러 가기
        </Button>
      </LocalizedClientLink>
    </div>
  )
}
