import { Headphones } from "lucide-react"

export function CsHeader() {
  return (
    <div className="bg-gradient-to-r from-[#f29219] to-[#f5a623] px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl text-center">
        <div className="mb-3 flex items-center justify-center gap-2">
          <Headphones className="h-8 w-8" />
          <h1 className="text-2xl font-bold">고객센터</h1>
        </div>
        <p className="text-sm opacity-90">
          궁금하신 점이 있으시면 언제든지 문의해주세요.
        </p>
        <p className="mt-2 text-sm font-medium">
          평일 09:00 - 18:00 (주말/공휴일 휴무)
        </p>
      </div>
    </div>
  )
}
