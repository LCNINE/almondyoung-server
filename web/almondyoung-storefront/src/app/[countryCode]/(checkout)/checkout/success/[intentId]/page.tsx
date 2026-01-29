import CheckoutHeader from "@/app/[countryCode]/(checkout)/checkout/checkout-header"
import { getIntent } from "@/lib/api/wallet"
import { notFound } from "next/navigation"
import { ChevronDownIcon, ReviewPromptCard } from "../_components"

interface PageProps {
  params: Promise<{ intentId: string; countryCode: string }>
}

interface IntentData {
  id: string
  customerId: string
  amount: number
  type: string
  status: string
  createdAt: string
  updatedAt: string
  metadata?: {
    orderId?: string
    orderName?: string
    [key: string]: any
  }
}

export default async function CheckoutSuccessPage({ params }: PageProps) {
  const { intentId } = await params

  const intent = await getIntent(intentId)
  console.log("============== intent 정보 ==============")
  console.log(intent)
  console.log("=======================================")
  if (!intent) {
    notFound()
  }

  return (
    <main className="flex min-h-screen w-full flex-col items-center gap-[41px] bg-[#f8f8f8] pb-20">
      {/* 헤더 컴포넌트 */}
      <CheckoutHeader title="주문/결제" />

      <h1 className="text-center text-2xl font-bold text-black">
        <span className="text-[#ffa500]">주문완료</span> 되었습니다.
      </h1>

      {/* 주문 요약 카드 */}
      <OrderSummaryCard intent={intent} />

      {/* 리뷰 유도 카드 */}
      <ReviewPromptCard />
    </main>
  )
}

async function OrderSummaryCard({ intent }: { intent: IntentData }) {
  return (
    <section className="w-full max-w-[816px] overflow-hidden rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white">
      <div className="flex flex-col divide-y-[0.5px] divide-[#d9d9d9]">
        <header className="flex items-center justify-between px-8 pt-8 pb-6">
          <h2 className="text-lg text-black">
            <span className="font-bold">주문번호 </span>
            <span>{intent.metadata?.orderId || intent.id}</span>
          </h2>
        </header>

        {/* 배송 정보 */}
        <div className="px-8 py-6">
          <dl>
            <div className="flex items-center justify-between">
              <dt className="sr-only">수령인</dt>
              <dd className="text-lg font-bold text-black">이연정 (이연정)</dd>
              <dd>
                <button
                  type="button"
                  className="rounded-[3px] border border-[#aeaeb2] bg-white px-2.5 py-1.5 text-center text-[13px] font-medium text-[#1e1e1e]"
                >
                  변경
                </button>
              </dd>
            </div>
            <div className="mt-4">
              <dt className="sr-only">연락처</dt>
              <dd className="text-base text-black">010-0000-0000</dd>
            </div>
            <div className="mt-2">
              <dt className="sr-only">배송 주소</dt>
              <dd className="text-base text-black">
                서울특별시 강북구 도봉로 89길 27(수유동) 4층
              </dd>
            </div>
          </dl>
        </div>

        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between p-8">
            <div className="flex items-center gap-6">
              <img
                className="h-[99px] w-[99px] rounded-[5px] object-cover"
                src="/images/product-thumb.png"
                alt="주문 상품 대표 이미지"
              />
              <p className="text-lg text-black">주문상품 1건</p>
            </div>
            <ChevronDownIcon className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-8 pb-8">
            <div className="rounded bg-gray-100 p-4">
              <p>주문 상품 상세 내역이 여기에 표시됩니다.</p>
            </div>
          </div>
        </details>

        <div className="p-8">
          <button
            type="button"
            className="flex h-[60px] w-full items-center justify-center rounded-[5px] bg-[#fff7e5] text-center text-[19px] font-bold text-[#ffa500] transition-colors hover:bg-[#ffedcc]"
          >
            주문 상세보기
          </button>
        </div>
      </div>
    </section>
  )
}
