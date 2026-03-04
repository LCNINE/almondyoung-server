import CheckoutHeader from "@/app/[countryCode]/(checkout)/checkout/checkout-header"
import { getIntent } from "@/lib/api/wallet"
import { getOrder } from "@/lib/api/medusa/orders"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import type { IntentDto } from "@/lib/types/dto/wallet"
import { notFound } from "next/navigation"
import Link from "next/link"
import { ChevronDownIcon, ReviewPromptCard } from "../_components"
import { HttpTypes } from "@medusajs/types"

interface PageProps {
  params: Promise<{ intentId: string; countryCode: string; usePoints: string }>
  searchParams: Promise<{ orderId?: string }>
}

const resolveItemThumbnail = (item: HttpTypes.StoreOrderLineItem) => {
  const rawThumbnail =
    item.thumbnail ?? item.variant?.product?.thumbnail ?? ""

  return getThumbnailUrl(rawThumbnail)
}

const getIntentOrderId = (intent: IntentDto) => {
  const orderId = intent.metadata?.["orderId"]
  return typeof orderId === "string" ? orderId : undefined
}

export default async function CheckoutSuccessPage({ params, searchParams }: PageProps) {
  const { intentId, countryCode } = await params
  const { orderId } = await searchParams

  const intent = await getIntent(intentId)
  console.log("============== intent 정보 ==============")
  console.log(intent)
  console.log("=======================================")

  if (!intent) {
    notFound()
  }

  const order = orderId ? await getOrder(orderId) : null

  return (
    <main className="flex min-h-screen w-full flex-col items-center gap-[41px] bg-[#f8f8f8] pb-20">
      {/* 헤더 컴포넌트 */}
      <CheckoutHeader title="주문/결제" />

      <h1 className="text-center text-2xl font-bold text-black">
        <span className="text-[#ffa500]">주문완료</span> 되었습니다.
      </h1>

      {/* 주문 요약 카드 */}
      <OrderSummaryCard intent={intent} order={order} countryCode={countryCode} />

      {/* 리뷰 유도 카드 */}
      <ReviewPromptCard />
    </main>
  )
}

async function OrderSummaryCard({
  intent,
  order,
  countryCode,
}: {
  intent: IntentDto
  order: HttpTypes.StoreOrder | null
  countryCode: string
}) {
  const address = order?.shipping_address
  const recipientName = address
    ? [address.first_name, address.last_name].filter(Boolean).join(" ")
    : null
  const addressLine = address
    ? [address.province, address.city, address.address_1].filter(Boolean).join(" ")
    : null
  const items = order?.items ?? []
  const firstItem = items[0]
  const firstThumbnail = firstItem ? resolveItemThumbnail(firstItem) : ""

  return (
    <section className="w-full max-w-[816px] overflow-hidden rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white">
      <div className="flex flex-col divide-y-[0.5px] divide-[#d9d9d9]">
        <header className="flex items-center justify-between px-8 pt-8 pb-6">
          <h2 className="text-lg text-black">
            <span className="font-bold">주문번호 </span>
            <span>
              {order?.display_id
                ? `#${order.display_id}`
                : getIntentOrderId(intent) || intent.id}
            </span>
          </h2>
        </header>

        {/* 배송 정보 */}
        <div className="px-8 py-6">
          <dl>
            <div className="flex items-center justify-between">
              <dt className="sr-only">수령인</dt>
              <dd className="text-lg font-bold text-black">
                {recipientName ?? "—"}
              </dd>
            </div>
            {address?.phone && (
              <div className="mt-4">
                <dt className="sr-only">연락처</dt>
                <dd className="text-base text-black">{address.phone}</dd>
              </div>
            )}
            {addressLine && (
              <div className="mt-2">
                <dt className="sr-only">배송 주소</dt>
                <dd className="text-base text-black">{addressLine}</dd>
              </div>
            )}
          </dl>
        </div>

        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between p-8">
            <div className="flex items-center gap-6">
              {firstThumbnail ? (
                <img
                  className="h-[99px] w-[99px] rounded-[5px] object-cover"
                  src={firstThumbnail}
                  alt="주문 상품 대표 이미지"
                />
              ) : (
                <div className="h-[99px] w-[99px] rounded-[5px] bg-gray-100" />
              )}
              <p className="text-lg text-black">
                주문상품 {items.length}건
              </p>
            </div>
            <ChevronDownIcon className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-8 pb-8">
            {items.length > 0 ? (
              <ul className="divide-y divide-gray-100">
                {items.map((item) => {
                  const thumb = resolveItemThumbnail(item)
                  return (
                    <li key={item.id} className="flex items-center gap-4 py-3">
                      {thumb && (
                        <img
                          className="h-16 w-16 rounded object-cover"
                          src={thumb}
                          alt={item.title}
                        />
                      )}
                      <div className="flex flex-1 flex-col">
                        <span className="text-sm font-medium text-black">
                          {item.title}
                        </span>
                        <span className="text-sm text-gray-500">
                          수량: {item.quantity}
                        </span>
                      </div>
                      {item.unit_price != null && (
                        <span className="text-sm font-medium text-black">
                          {item.unit_price.toLocaleString("ko-KR")}원
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="rounded bg-gray-100 p-4">
                <p>주문 상품 상세 내역이 여기에 표시됩니다.</p>
              </div>
            )}
          </div>
        </details>

        <div className="p-8">
          {order ? (
            <Link
              href={`/${countryCode}/mypage/order/details?orderId=${order.id}`}
              className="flex h-[60px] w-full items-center justify-center rounded-[5px] bg-[#fff7e5] text-center text-[19px] font-bold text-[#ffa500] transition-colors hover:bg-[#ffedcc]"
            >
              주문 상세보기
            </Link>
          ) : (
            <button
              type="button"
              className="flex h-[60px] w-full items-center justify-center rounded-[5px] bg-[#fff7e5] text-center text-[19px] font-bold text-[#ffa500] transition-colors hover:bg-[#ffedcc]"
            >
              주문 상세보기
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
