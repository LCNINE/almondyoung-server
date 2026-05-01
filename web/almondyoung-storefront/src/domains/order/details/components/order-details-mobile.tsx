import Link from "next/link"
import { HttpTypes } from "@medusajs/types"
import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import {
  OrderInfoCardRoot,
  OrderInfoCardRow,
  OrderInfoCardRowItem,
  OrderInfoCardDivider,
} from "@components/orders/order-info-card.atomic"
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

export const OrderDetailsMobile = ({
  order,
  countryCode,
}: {
  order: HttpTypes.StoreOrder | null
  countryCode: string
}) => {
  if (!order) {
    return (
      <main className="min-h-screen bg-[#f8f8f8] p-4 text-center text-gray-500">
        주문 정보를 찾을 수 없습니다.
      </main>
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
    <main className="min-h-screen w-full bg-[#f8f8f8] font-sans">
      <div className="p-4 pb-24">
        <header className="mb-3 flex items-center justify-between text-sm">
          <h2 className="text-[13px] font-bold text-gray-800">
            {formatDate(order.created_at)} 주문
          </h2>
          <span className="text-gray-500">
            주문번호 #{order.display_id ?? order.id.slice(0, 12)}
          </span>
        </header>

        <section aria-labelledby="payment-details-title">
          <h3 id="payment-details-title" className="sr-only">
            결제 정보
          </h3>
          <OrderInfoCardRoot className="p-4">
            <OrderInfoCardRow className="mb-2">
              <OrderInfoCardRowItem className="text-gray-500">
                총 상품 가격
              </OrderInfoCardRowItem>
              <OrderInfoCardRowItem className="text-right text-gray-800">
                {formatAmount(order.item_total)}
              </OrderInfoCardRowItem>
            </OrderInfoCardRow>
            <OrderInfoCardRow className="mb-2">
              <OrderInfoCardRowItem className="text-gray-500">
                배송비
              </OrderInfoCardRowItem>
              <OrderInfoCardRowItem className="text-right text-gray-800">
                {formatAmount(order.shipping_total)}
              </OrderInfoCardRowItem>
            </OrderInfoCardRow>
            <OrderInfoCardRow className="mb-2">
              <OrderInfoCardRowItem className="text-gray-500">
                할인금액
              </OrderInfoCardRowItem>
              <OrderInfoCardRowItem className="text-right text-gray-800">
                {formatAmount(order.discount_total)}
              </OrderInfoCardRowItem>
            </OrderInfoCardRow>
            {membershipDiscount > 0 && (
              <OrderInfoCardRow className="mb-2">
                <OrderInfoCardRowItem className="text-gray-500">
                  멤버십 할인
                </OrderInfoCardRowItem>
                <OrderInfoCardRowItem className="text-right text-gray-800">
                  {formatAmount(membershipDiscount)}
                </OrderInfoCardRowItem>
              </OrderInfoCardRow>
            )}
            <OrderInfoCardRow>
              <OrderInfoCardRowItem className="font-bold text-gray-800">
                총 결제 금액
              </OrderInfoCardRowItem>
              <OrderInfoCardRowItem className="text-right font-bold text-gray-800">
                {formatAmount(order.total)}
              </OrderInfoCardRowItem>
            </OrderInfoCardRow>
          </OrderInfoCardRoot>
        </section>

        <section aria-labelledby="shipping-info-title" className="mt-3">
          <OrderInfoCardRoot className="p-4">
            <h3
              id="shipping-info-title"
              className="text-base font-bold text-gray-800"
            >
              {receiverName || "-"}
            </h3>
            <p className="mt-1 text-sm text-gray-600">{address?.phone || "-"}</p>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex">
                <dt className="w-20 shrink-0 text-gray-500">우편번호</dt>
                <dd className="text-gray-800">{postalCode}</dd>
              </div>
              <div className="flex">
                <dt className="w-20 shrink-0 text-gray-500">기본주소</dt>
                <dd className="text-gray-800">{primaryAddress}</dd>
              </div>
              <div className="flex">
                <dt className="w-20 shrink-0 text-gray-500">상세주소</dt>
                <dd className="text-gray-800">{detailAddress}</dd>
              </div>
            </dl>
            <OrderInfoCardDivider />
            <dl className="flex text-sm">
              <dt className="w-24 shrink-0 text-gray-500">상태</dt>
              <dd className="text-gray-800">{statusLabel}</dd>
            </dl>
          </OrderInfoCardRoot>
        </section>

        <section className="mt-3 rounded-lg bg-white shadow-sm">
          <div className="p-4">
            <h3 className="font-bold text-gray-800">{statusLabel}</h3>
            <p className="mt-2 text-sm text-gray-500">
              상품 {order.items?.length ?? 0}건
            </p>
          </div>

          <div className="border-border-muted border-t p-4">
            {order.items?.map((item) => {
              const thumbnail = getThumbnailUrl(
                item.thumbnail ?? item.variant?.product?.thumbnail ?? ""
              )
              return (
                <article key={item.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt={item.title}
                      className="h-20 w-20 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <div className="h-20 w-20 shrink-0 rounded-md bg-gray-100" />
                  )}
                  <div className="flex-grow">
                    <p className="font-semibold text-gray-800">{item.title}</p>
                    <p className="mt-1 text-sm text-gray-500">
                      {formatAmount(item.unit_price)} · {item.quantity}개
                    </p>
                    {item.variant?.title && item.variant.title !== "Default" && (
                      <p className="mt-1 text-xs text-gray-400">- {item.variant.title}</p>
                    )}
                  </div>
                  <CustomButton variant="outline" size="sm">
                    장바구니 담기
                  </CustomButton>
                </article>
              )
            })}
          </div>

          <div className="border-border-muted mt-2 flex gap-2 border-t p-4">
            <CustomButton variant="outline" size="lg">
              주문 취소 / 반품 신청
            </CustomButton>
            <Link href={`/${countryCode}/mypage/order/track?orderId=${order.id}`}>
              <CustomButton variant="outline" size="lg">
                배송 조회
              </CustomButton>
            </Link>
          </div>
        </section>
      </div>
    </main>
  )
}
