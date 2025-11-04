import { ProductCard } from "@lib/types/ui/product"
import { BasicProductCard } from "./product-card"
import Pagination from "@components/common/pagination"
import { ChevronLeft, ChevronRight } from "lucide-react"

export default function ProductsGrid({ items, currentProducts, totalPages, currentPage, setCurrentPage }: { items: ProductCard[], currentProducts: ProductCard[], totalPages: number, currentPage: number, setCurrentPage: (page: number) => void }) {
  return (
    <div>
      {/* Desktop: 페이지네이션 */}
      <div className="hidden md:block">
        {/* 상품 그리드 */}
        <div className="grid grid-cols-3 gap-4 md:grid-cols-3 lg:grid-cols-5 lg:gap-6">
          {currentProducts.map((product) => {
            return <BasicProductCard key={product.id} product={product} />
          })}
        </div>
      </div>
      {/* Mobile: 가로스크롤 한줄 */}
      <div className="block md:hidden">
        <div className="relative">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 scroll-container">
            {items.map((product) => {
              return <BasicProductCard key={product.id} product={product} />
            })}
          </div>
          {/* 좌측 스크롤 버튼 */}
          <button 
            className="absolute left-0 top-1/2 -translate-y-1/2 bg-white shadow-lg rounded-full p-2 z-10"
            onClick={() => {
              const container = document.querySelector('.scroll-container')
              if (container) container.scrollBy({ left: -300, behavior: 'smooth' })
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {/* 우측 스크롤 버튼 */}
          <button 
            className="absolute right-0 top-1/2 -translate-y-1/2 bg-white shadow-lg rounded-full p-2 z-10"
            onClick={() => {
              const container = document.querySelector('.scroll-container')
              if (container) container.scrollBy({ left: 300, behavior: 'smooth' })
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
      {/* 페이지네이션 버튼 */}
      {totalPages > 1 && (
        <Pagination showPageNumbers={true} totalPages={totalPages} currentPage={currentPage} onPageChange={setCurrentPage} />
      )}
    </div>
  )
}