import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { CustomButton } from "@/components/shared/custom-buttons/custom-button"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import { getOrder } from "@/lib/api/medusa/orders"
import { getOrderReturns } from "@/lib/api/medusa/returns"
import {
  getOrderActionsByMedusaId,
  getReturnProgressByMedusaId,
} from "@/lib/api/orders/store-orders"
import { getPaymentMethodTypes } from "@/lib/api/wallet"
import ReturnDetail from "domains/order/return-detail/return-detail"
import { getTranslations } from "next-intl/server"

interface ReturnDetailPageProps {
  params: Promise<{ countryCode: string; returnId: string }>
  searchParams: Promise<{ orderId?: string }>
}

export async function generateMetadata() {
  const t = await getTranslations("mypage.order.returnDetail")

  return { title: t("title") }
}

export default async function ReturnDetailPage({
  params,
  searchParams,
}: ReturnDetailPageProps) {
  const { returnId } = await params
  const { orderId } = await searchParams
  const t = await getTranslations("mypage.order.returnDetail")

  const [rawOrder, customer, returns, progress] = orderId
    ? await Promise.all([
        getOrder(orderId),
        retrieveCustomer(),
        getOrderReturns(orderId),
        getReturnProgressByMedusaId(orderId, returnId),
      ])
    : [null, null, null, null]

  // /store/orders/:id 는 주인을 가리지 않는다 — 남의 주문이면 없는 반품과 같은 화면
  const order =
    rawOrder?.customer_id && customer?.id === rawOrder.customer_id
      ? rawOrder
      : null
  const ret = order
    ? (returns?.find((r) => r.returnId === returnId) ?? null)
    : null
  const intentId = (
    order?.payment_collections?.[0]?.payment_sessions?.[0]?.data as
      | Record<string, unknown>
      | undefined
  )?.intentId as string | undefined
  const [actions, methodTypes] =
    order && ret
      ? await Promise.all([
          getOrderActionsByMedusaId(order.id).catch(() => null),
          intentId ? getPaymentMethodTypes(intentId) : null,
        ])
      : [null, null]
  const methodLabel = methodTypes?.length
    ? methodTypes
        .map((type) =>
          t.has(`paymentMethod.${type}`)
            ? t(`paymentMethod.${type}` as "paymentMethod.TOSS")
            : t("paymentMethod.other")
        )
        .filter((label, i, all) => all.indexOf(label) === i)
        .join(" + ")
    : null

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("title"),
      }}
    >
      <MypageLayout>
        {order && ret ? (
          <ReturnDetail
            order={order}
            ret={ret}
            progress={progress}
            paymentMethodLabel={
              actions?.refundSummary?.paymentMethodLabel ?? methodLabel
            }
          />
        ) : (
          <div className="bg-white px-4 py-8 md:min-h-screen md:px-6">
            <p className="text-foreground font-medium">{t("notFound")}</p>
            <div className="mt-6">
              <LocalizedClientLink href="/mypage/order/list">
                <CustomButton variant="outline" color="secondary" size="md">
                  {t("toList")}
                </CustomButton>
              </LocalizedClientLink>
            </div>
          </div>
        )}
      </MypageLayout>
    </WithHeaderLayout>
  )
}
