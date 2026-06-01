"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import { buildAddressLine } from "@/lib/utils/address-line"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { calculateMembershipDiscount } from "@/lib/utils/price-utils"
import { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"

const formatDate = (date?: string | Date | null) => {
  if (!date) return "-"
  const parsed = date instanceof Date ? date : new Date(date)
  return parsed.toLocaleDateString()
}

const formatAmount = (value?: number | null) =>
  `${(value ?? 0).toLocaleString()}원`

const getOrderStatusKey = (order: HttpTypes.StoreOrder): string => {
  if (order.status === "canceled") return "orderCancel"
  if (order.fulfillment_status === "fulfilled") return "delivered"
  if (order.fulfillment_status === "shipped") return "shipping"
  if (order.fulfillment_status === "partially_fulfilled") return "partialShipping"
  if (order.fulfillment_status === "not_fulfilled") return "preparing"
  if (order.payment_status === "awaiting") return "paymentPending"
  return "paid"
}

export const OrderDetailsDesktop = ({
  order,
  countryCode,
}: {
  order: HttpTypes.StoreOrder | null
  countryCode: string
}) => {
  const tLabels = useTranslations("mypage.order.labels")
  const tStatus = useTranslations("mypage.order.status")
  const tActions = useTranslations("mypage.order.actions")

  if (!order) {
    return (
      <div className="bg-white py-10 text-center text-gray-500">
        {tLabels("notFound")}
      </div>
    )
  }

  const address = order.shipping_address
  const receiverName = [address?.first_name, address?.last_name]
    .filter(Boolean)
    .join(" ")
  const addressLine = buildAddressLine({
    province: address?.province,
    city: address?.city,
    address1: address?.address_1,
    address2: address?.address_2,
  })
  const postalCode = address?.postal_code || "-"
  const primaryAddress = address?.address_1 || addressLine || "-"
  const detailAddress = address?.address_2 || "-"
  const statusLabel = tStatus(getOrderStatusKey(order))
  const membershipDiscount = calculateMembershipDiscount(order.items ?? [])

  return (
    <div className="bg-white py-4 font-['Pretendard'] md:px-6">
      <section className="mb-[35px] flex flex-col gap-3.5">
        <h1 className="text-2xl font-bold text-black">{tLabels("title")}</h1>
        <div className="flex w-full max-w-[813px] flex-col gap-2 bg-white">
          <p className="text-lg text-black">
            {tLabels("orderDateSuffix", { date: formatDate(order.created_at) })}
          </p>
          <p className="text-lg text-black">
            <span className="font-bold">{tLabels("orderNumber")} </span>
            <span className="underline">
              #{order.display_id ?? order.id.slice(0, 12)}
            </span>
          </p>
        </div>
      </section>

      <section className="mb-[35px] space-y-3 border border-gray-200 p-7">
        <h2 className="text-2xl font-bold text-black">{statusLabel}</h2>
        {order.items?.map((item) => {
          const thumbnail = getThumbnailUrl(
            item.thumbnail ?? item.variant?.product?.thumbnail ?? ""
          )
          return (
            <article
              key={item.id}
              className="flex items-end gap-6 border-b border-gray-100 py-4 last:border-b-0"
            >
              <figure className="shrink-0">
                {thumbnail ? (
                  <img
                    className="h-24 w-24 rounded-[5px] border border-gray-200 object-cover"
                    src={thumbnail}
                    alt={item.title}
                  />
                ) : (
                  <div className="h-24 w-24 rounded-[5px] border border-gray-200 bg-gray-100" />
                )}
              </figure>
              <div className="min-w-32 flex-1">
                <h3 className="text-lg text-black">{item.title}</h3>
                <p className="mt-2 text-base text-gray-600">
                  {formatAmount(item.unit_price)} · {item.quantity}
                </p>
                {item.variant?.title && item.variant.title !== "Default" && (
                  <p className="mt-1 text-sm text-gray-500">- {item.variant.title}</p>
                )}
              </div>
              <CustomButton variant="outline" color="secondary" size="sm">
                {tActions("addToCart")}
              </CustomButton>
            </article>
          )
        })}
      </section>

      <section className="mb-[35px] flex flex-col gap-4">
        <h2 className="text-lg font-bold text-black">{tLabels("recipientInfo")}</h2>
        <hr className="border-t-[0.5px] border-stone-900" />
        <dl className="space-y-3">
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">{tLabels("recipient")}</dt>
            <dd className="text-base text-black">{receiverName || "-"}</dd>
          </div>
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">{tLabels("contact")}</dt>
            <dd className="text-base text-black">{address?.phone || "-"}</dd>
          </div>
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">{tLabels("postcode")}</dt>
            <dd className="text-base text-black">{postalCode}</dd>
          </div>
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">{tLabels("address")}</dt>
            <dd className="text-base text-black">{primaryAddress}</dd>
          </div>
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">{tLabels("addressDetail")}</dt>
            <dd className="text-base text-black">{detailAddress}</dd>
          </div>
        </dl>
      </section>

      <section className="mb-[35px] flex flex-col gap-4">
        <h2 className="text-lg font-bold text-black">{tLabels("paymentInfo")}</h2>
        <div className="border-t-[0.5px] border-stone-900">
          <div className="grid grid-cols-2 gap-4 py-3.5">
            <div className="space-y-2">
              <p className="text-base text-black">
                {tLabels("paymentStatus")}: {order.payment_status}
              </p>
              <p className="text-base text-black">
                {tLabels("paymentMethod")}:{" "}
                {order.payment_collections?.length
                  ? tLabels("paymentMethodRegistered")
                  : "-"}
              </p>
            </div>
            <dl className="bg-gray-background space-y-2 p-3.5">
              <div className="flex items-center justify-between">
                <dt className="text-base text-black">{tLabels("totalPrice")}</dt>
                <dd className="text-base text-black">
                  {formatAmount(order.item_total)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-base text-black">{tLabels("discount")}</dt>
                <dd className="text-base text-black">
                  {formatAmount(order.discount_total)}
                </dd>
              </div>
              {membershipDiscount > 0 && (
                <div className="flex items-center justify-between">
                  <dt className="text-base text-black">
                    {tLabels("membershipDiscount")}
                  </dt>
                  <dd className="text-base text-black">
                    {formatAmount(membershipDiscount)}
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between">
                <dt className="text-base text-black">{tLabels("shippingFee")}</dt>
                <dd className="text-base text-black">
                  {formatAmount(order.shipping_total)}
                </dd>
              </div>
            </dl>
          </div>
          <dl className="border-t-[0.5px] border-b-[0.5px] border-zinc-300 bg-gray-background p-3.5">
            <div className="flex items-center justify-between">
              <dt className="text-base font-bold text-black">
                {tLabels("totalPayment")}
              </dt>
              <dd className="text-base font-bold text-black">
                {formatAmount(order.total)}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="flex justify-center gap-2.5">
        <LocalizedClientLink
          href="/mypage/order/list"
          className="inline-flex items-center justify-center rounded-[5px] px-4 py-3 text-sm font-medium text-amber-500 outline-1 outline-amber-500"
        >
          {tActions("backToList")}
        </LocalizedClientLink>
        {(order.fulfillment_status === 'shipped' || order.fulfillment_status === 'fulfilled' || order.fulfillment_status === 'partially_fulfilled') && (
          <LocalizedClientLink
            href={`/mypage/order/track?orderId=${order.id}`}
            className="inline-flex items-center justify-center rounded-[5px] px-4 py-3 text-sm text-black outline-1 outline-zinc-400"
          >
            {tActions("trackDelivery")}
          </LocalizedClientLink>
        )}
      </section>
    </div>
  )
}
