import { Package } from "lucide-react"

interface ProductSectionEmptyProps {
  title?: string
  description?: string
}

export function ProductSectionEmpty({
  title = "상품이 없습니다",
  description = "등록된 상품이 없습니다.",
}: ProductSectionEmptyProps) {
  return (
    <>
      {/* mobile */}
      <div className="flex flex-col items-center justify-center px-4 py-16 md:hidden">
        <div className="bg-gray-10 mb-4 flex h-16 w-16 items-center justify-center rounded-full">
          <Package className="text-gray-40 h-8 w-8" />
        </div>
        <h3 className="text-gray-90 mb-2 text-base font-semibold">{title}</h3>
        <p className="text-gray-60 text-center text-sm">{description}</p>
      </div>

      {/* desktop */}
      <div className="hidden flex-col items-center justify-center px-6 py-24 md:flex">
        <div className="bg-gray-10 mb-6 flex h-20 w-20 items-center justify-center rounded-full">
          <Package className="text-gray-40 h-10 w-10" />
        </div>
        <h3 className="text-gray-90 mb-3 text-xl font-semibold">{title}</h3>
        <p className="text-gray-60 max-w-md text-center text-base">
          {description}
        </p>
      </div>
    </>
  )
}
