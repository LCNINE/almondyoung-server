import Link from "next/link"
import { HttpTypes } from "@medusajs/types"
import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { calculateMembershipDiscount } from "@/lib/utils/price-utils"
import { buildAddressLine } from "@/lib/utils/address-line"

const formatDate = (date?: string | Date | null) => {
  if (!date) return "-"
  const parsed = date instanceof Date ? date : new Date(date)
  return parsed.toLocaleDateString("ko-KR")
}

const formatAmount = (value?: number | null) => `${(value ?? 0).toLocaleString()}원`

const getOrderStatusLabel = (order: HttpTypes.StoreOrder) => {
  if (order.status === "canceled") return "주문 취소"
  if (order.fulfillment_status === "fulfilled") return "배송 완료"
  if (order.fulfillment_status === "shipped") return "배송 중"
  if (order.fulfillment_status === "partially_fulfilled") return "부분 배송"
  if (order.fulfillment_status === "not_fulfilled") return "상품 준비 중"
  if (order.payment_status === "awaiting") return "결제 대기"
  return "결제 완료"
}

export const OrderDetailsDesktop = ({
  order,
  countryCode,
}: {
  order: HttpTypes.StoreOrder | null
  countryCode: string
}) => {
  if (!order) {
    return (
      <div className="bg-white py-10 text-center text-gray-500">
        주문 정보를 찾을 수 없습니다.
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
  const statusLabel = getOrderStatusLabel(order)
  const membershipDiscount = calculateMembershipDiscount(order.items ?? [])

  return (
    <div className="bg-white py-4 font-['Pretendard'] md:px-6">
      <section className="mb-[35px] flex flex-col gap-3.5">
        <h1 className="text-2xl font-bold text-black">주문상세</h1>
        <div className="flex w-full max-w-[813px] flex-col gap-2 bg-white">
          <p className="text-lg text-black">{formatDate(order.created_at)} 주문</p>
          <p className="text-lg text-black">
            <span className="font-bold">주문번호 </span>
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
                  {formatAmount(item.unit_price)} · {item.quantity}개
                </p>
                {item.variant?.title && item.variant.title !== "Default" && (
                  <p className="mt-1 text-sm text-gray-500">- {item.variant.title}</p>
                )}
              </div>
              <CustomButton variant="outline" color="secondary" size="sm">
                장바구니 담기
              </CustomButton>
            </article>
          )
        })}
      </section>

      <section className="mb-[35px] flex flex-col gap-4">
        <h2 className="text-lg font-bold text-black">받는사람 정보</h2>
        <hr className="border-t-[0.5px] border-stone-900" />
        <dl className="space-y-3">
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">받는사람</dt>
            <dd className="text-base text-black">{receiverName || "-"}</dd>
          </div>
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">연락처</dt>
            <dd className="text-base text-black">{address?.phone || "-"}</dd>
          </div>
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">우편번호</dt>
            <dd className="text-base text-black">{postalCode}</dd>
          </div>
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">기본주소</dt>
            <dd className="text-base text-black">{primaryAddress}</dd>
          </div>
          <div className="flex gap-12">
            <dt className="w-20 text-base text-black">상세주소</dt>
            <dd className="text-base text-black">{detailAddress}</dd>
          </div>
        </dl>
      </section>

      <section className="mb-[35px] flex flex-col gap-4">
        <h2 className="text-lg font-bold text-black">결제 정보</h2>
        <div className="border-t-[0.5px] border-stone-900">
          <div className="grid grid-cols-2 gap-4 py-3.5">
            <div className="space-y-2">
              <p className="text-base text-black">결제상태: {order.payment_status}</p>
              <p className="text-base text-black">
                결제수단: {order.payment_collections?.length ? "등록된 결제수단" : "-"}
              </p>
            </div>
            <dl className="bg-gray-background space-y-2 p-3.5">
              <div className="flex items-center justify-between">
                <dt className="text-base text-black">총 상품 가격</dt>
                <dd className="text-base text-black">{formatAmount(order.item_total)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-base text-black">할인금액</dt>
                <dd className="text-base text-black">
                  {formatAmount(order.discount_total)}
                </dd>
              </div>
              {membershipDiscount > 0 && (
                <div className="flex items-center justify-between">
                  <dt className="text-base text-black">멤버십 할인</dt>
                  <dd className="text-base text-black">
                    {formatAmount(membershipDiscount)}
                  </dd>
                </div>
              )}
              <div className="flex items-center justify-between">
                <dt className="text-base text-black">배송비</dt>
                <dd className="text-base text-black">{formatAmount(order.shipping_total)}</dd>
              </div>
            </dl>
          </div>
          <dl className="border-t-[0.5px] border-b-[0.5px] border-zinc-300 bg-gray-background p-3.5">
            <div className="flex items-center justify-between">
              <dt className="text-base font-bold text-black">총 결제금액</dt>
              <dd className="text-base font-bold text-black">{formatAmount(order.total)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="flex justify-center gap-2.5">
        <Link
          href={`/${countryCode}/mypage/order/list`}
          className="inline-flex items-center justify-center rounded-[5px] px-4 py-3 text-sm font-medium text-amber-500 outline-1 outline-amber-500"
        >
          주문목록 돌아가기
        </Link>
        <Link
          href={`/${countryCode}/mypage/order/track?orderId=${order.id}`}
          className="inline-flex items-center justify-center rounded-[5px] px-4 py-3 text-sm text-black outline-1 outline-zinc-400"
        >
          배송 조회
        </Link>
      </section>
    </div>
  )
}
