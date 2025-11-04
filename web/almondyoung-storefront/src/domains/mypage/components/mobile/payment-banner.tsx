import { ChevronRight } from "lucide-react"

export function PaymentBanner() {
  return (
    <section
      aria-label="후불결제 안내"
      className="relative flex items-center justify-between overflow-hidden rounded-lg bg-orange-400 p-4 text-white"
    >
      <h3 className="text-lg font-bold">
        상품먼저 받고
        <br />
        결제는 나중에 하세요!
      </h3>
      <span className="text-5xl opacity-50">💳</span>
      <ChevronRight className="h-5 w-5" />
    </section>
  )
}
