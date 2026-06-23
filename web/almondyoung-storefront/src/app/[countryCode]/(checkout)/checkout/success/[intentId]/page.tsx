import CheckoutHeader from "@/app/[countryCode]/(checkout)/checkout/checkout-header"
import { getIntent } from "@/lib/api/wallet"
import { getOrder } from "@/lib/api/medusa/orders"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { ChevronDownIcon, ReviewPromptCard } from "../_components"
import { HttpTypes } from "@medusajs/types"
import { buildAddressLine } from "@/lib/utils/address-line"
import { createWebLogger } from "@packages/web-observability"

// 주문 정보는 사용자별로 다르므로 캐싱 비활성화
export const dynamic = "force-dynamic"

const logger = createWebLogger({
  component: "storefront.checkout-success",
  route: "/[countryCode]/checkout/success/[intentId]",
})

interface PageProps {
  params: Promise<{ intentId: string; countryCode: string; usePoints: string }>
  searchParams: Promise<{ orderId?: string }>
}

const resolveItemThumbnail = (item: HttpTypes.StoreOrderLineItem) => {
  const rawThumbnail = item.thumbnail ?? item.variant?.product?.thumbnail ?? ""

  return getThumbnailUrl(rawThumbnail)
}

async function getIntentOrNull(intentId: string) {
  try {
    return await getIntent(intentId)
  } catch (err) {
    logger.warn("storefront.checkout_success.intent_lookup_failed", {
      error: err,
      attributes: { intent_id: intentId },
    })
    return null
  }
}

async function getOrderOrNull(orderId?: string) {
  if (!orderId) return null

  try {
    return await getOrder(orderId)
  } catch (err) {
    logger.warn("storefront.checkout_success.order_lookup_failed", {
      error: err,
      attributes: { order_id: orderId },
    })
    return null
  }
}

export default async function CheckoutSuccessPage({
  params,
  searchParams,
}: PageProps) {
  const { intentId, countryCode } = await params
  const { orderId } = await searchParams

  const intent = await getIntentOrNull(intentId)
  const t = await getTranslations("checkout")

  logger.info("storefront.checkout_success.render_started", {
    attributes: {
      intent_id: intentId,
      order_id: orderId ?? null,
      intent_user_id: intent?.userId ?? null,
      has_intent_metadata: Boolean(intent?.metadata),
    },
  })

  const rawOrder = await getOrderOrNull(orderId)

  // 소유권 검증: intent의 이메일과 order의 이메일이 일치하는지 확인
  const intentEmail = intent?.metadata?.["customerEmail"]
  const orderEmail = rawOrder?.email
  const isOwnerMatch =
    rawOrder && intentEmail && orderEmail && intentEmail === orderEmail

  // 소유권이 일치하지 않으면 order 정보를 표시하지 않음 (보안)
  const order = isOwnerMatch ? rawOrder : null

  logger.info("storefront.checkout_success.order_resolved", {
    attributes: {
      intent_id: intentId,
      order_id: rawOrder?.id ?? null,
      order_display_id: rawOrder?.display_id ?? null,
      customer_id: rawOrder?.customer_id ?? null,
      has_intent_email: Boolean(intentEmail),
      has_order_email: Boolean(orderEmail),
      is_owner_match: Boolean(isOwnerMatch),
      has_shipping_name: Boolean(
        rawOrder?.shipping_address?.first_name ||
          rawOrder?.shipping_address?.last_name
      ),
    },
  })

  return (
    <main className="flex min-h-screen w-full flex-col items-center gap-[41px] bg-[#f8f8f8] pb-20">
      {/* 헤더 컴포넌트 */}
      <CheckoutHeader title={t("header.title")} />

      <h1 className="text-center text-2xl font-bold text-black">
        <span className="text-[#ffa500]">
          {t("success.completedHighlight")}
        </span>
        {t("success.completedSuffix")}
      </h1>

      {/* 주문 요약 카드 */}
      <OrderSummaryCard order={order} countryCode={countryCode} />

      {/* 리뷰 유도 카드 */}
      <ReviewPromptCard />
    </main>
  )
}

async function OrderSummaryCard({
  order,
  countryCode,
}: {
  order: HttpTypes.StoreOrder | null
  countryCode: string
}) {
  const t = await getTranslations("checkout.success")
  const tCart = await getTranslations("cart")
  // todo: 소유권 불일치 문제 해결되면 지울것
  // order가 없으면 (소유권 불일치 등) 간단한 안내 카드 표시,
  if (!order) {
    return (
      <section className="w-full max-w-[816px] overflow-hidden rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white">
        <div className="flex flex-col items-center gap-4 p-8">
          <p className="text-lg text-black">{t("noOrder.completed")}</p>
          <p className="text-sm text-gray-500">
            {t("noOrder.detailsInMypage")}
          </p>
          <Link
            href={`/${countryCode}/mypage/order/list`}
            className="mt-4 flex h-[60px] w-full items-center justify-center rounded-[5px] bg-[#fff7e5] text-center text-[19px] font-bold text-[#ffa500] transition-colors hover:bg-[#ffedcc]"
          >
            {t("noOrder.orderListBtn")}
          </Link>
        </div>
      </section>
    )
  }

  const address = order.shipping_address
  const recipientName = address
    ? [address.first_name, address.last_name].filter(Boolean).join(" ")
    : null
  const addressLine = address
    ? buildAddressLine({
        province: address.province,
        city: address.city,
        address1: address.address_1,
      })
    : null
  const items = order.items ?? []
  const firstItem = items[0]
  const firstThumbnail = firstItem ? resolveItemThumbnail(firstItem) : ""

  return (
    <section className="w-full max-w-[816px] overflow-hidden rounded-[10px] border-[0.5px] border-[#d9d9d9] bg-white">
      <div className="flex flex-col divide-y-[0.5px] divide-[#d9d9d9]">
        <header className="flex items-center justify-between px-8 pt-8 pb-6">
          <h2 className="text-lg text-black">
            <span className="font-bold">{t("orderNumberLabel")} </span>
            <span>#{order.display_id}</span>
          </h2>
        </header>

        {/* 배송 정보 */}
        <div className="px-8 py-6">
          <dl>
            <div className="flex items-center justify-between">
              <dt className="sr-only">{t("sr.recipient")}</dt>
              <dd className="text-lg font-bold text-black">
                {recipientName ?? t("fallbackName")}
              </dd>
            </div>
            {address?.phone && (
              <div className="mt-4">
                <dt className="sr-only">{t("sr.contact")}</dt>
                <dd className="text-base text-black">{address.phone}</dd>
              </div>
            )}
            {addressLine && (
              <div className="mt-2">
                <dt className="sr-only">{t("sr.address")}</dt>
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
                  alt={t("mainImageAlt")}
                />
              ) : (
                <div className="h-[99px] w-[99px] rounded-[5px] bg-gray-100" />
              )}
              <p className="text-lg text-black">
                {t("orderItemsCount", { count: items.length })}
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
                          {t("quantityLabel", { quantity: item.quantity })}
                        </span>
                      </div>
                      {item.unit_price != null && (
                        <span className="text-sm font-medium text-black">
                          {`${item.unit_price.toLocaleString("ko-KR")}${tCart("won")}`}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="rounded bg-gray-100 p-4">
                <p>{t("orderDetailsFallback")}</p>
              </div>
            )}
          </div>
        </details>

        <div className="p-8">
          <Link
            href={`/${countryCode}/mypage/order/details?orderId=${order.id}`}
            className="flex h-[60px] w-full items-center justify-center rounded-[5px] bg-[#fff7e5] text-center text-[19px] font-bold text-[#ffa500] transition-colors hover:bg-[#ffedcc]"
          >
            {t("orderDetailBtn")}
          </Link>
        </div>
      </div>
    </section>
  )
}
