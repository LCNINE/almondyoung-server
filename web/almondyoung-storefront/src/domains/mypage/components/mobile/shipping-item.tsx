import { ChevronRight } from "lucide-react"

export function ShippingItem() {
  return (
    <section
      aria-labelledby="shipping-items-heading"
      className="rounded-lg bg-white p-4 shadow-sm"
    >
      <h2 id="shipping-items-heading" className="text-base font-bold">
        배송 중 상품
      </h2>
      <a
        href="#"
        className="-mx-3 mt-2 -mb-3 flex items-center gap-4 rounded-lg p-3 transition-colors hover:bg-gray-50"
      >
        <img
          src="https://via.placeholder.com/100"
          alt="배송중인 상품"
          className="h-16 w-16 rounded-md"
        />
        <div className="flex-grow text-sm">
          <p className="text-gray-500">주문번호 20102-202031</p>
          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-800">
            배송 중
          </span>
          <p className="mt-1 font-semibold text-gray-800">상품 준비 중</p>
        </div>
        <ChevronRight className="h-5 w-5" />
      </a>
    </section>
  )
}
