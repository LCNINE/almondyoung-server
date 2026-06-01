import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@components/layout"
import { OrderInfoCardShipping } from "@components/orders/order-info-cards"
import { ExternalLink } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { DeliveryHeader } from "domains/order/track/components"
import { Accordion } from "./accordion"
import { getOrderTrackingByMedusaId, type StoreOrderTrackingResponse } from "@/lib/api/orders/store-orders"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"

interface OrderTrackPageProps {
  searchParams: Promise<{ orderId?: string }>
}

function trackingStatusToStep(status: StoreOrderTrackingResponse["status"]): number {
  switch (status) {
    case "not_shipped": return 1
    case "preparing": return 2
    case "shipping": return 4
    case "delivered": return 5
    default: return 1
  }
}

export default async function OrderTrackPage({ searchParams }: OrderTrackPageProps) {
  const t = await getTranslations("mypage.page")
  const tDelivery = await getTranslations("mypage.order.delivery")
  const tOrderActions = await getTranslations("mypage.order.actions")
  const { orderId } = await searchParams

  let tracking: StoreOrderTrackingResponse | null = null
  if (orderId) {
    try {
      tracking = await getOrderTrackingByMedusaId(orderId)
    } catch {
      // 배송 정보 조회 실패 시 null로 처리 (페이지는 렌더됨)
    }
  }

  const currentStep = tracking ? trackingStatusToStep(tracking.status) : 1
  const completedDate = tracking?.shipments.find((s) => s.deliveredAt)?.deliveredAt
  const faqData = [
    {
      id: "faq-1",
      question: "[상품누락] 상품을 구매했는데 일부만 배송되었어요.",
      answer: (
        <>
          <p>
            상품이 누락되었다면 교환을 통해 상품을 다시 받거나, 반품 후 환불을
            받을 수 있습니다. 구성품의 일부가 누락된 경우에는 부분 배송이
            불가하므로 상품 전체를 교환/반품으로 진행해 주시기 바랍니다. 교환 및
            반품은 아래의 경로를 통해 직접 신청이 가능합니다.
          </p>
          <div>
            <p>
              <strong className="font-bold">교환/반품 신청하기</strong>
            </p>
            <p>
              • 마이쿠팡 →{" "}
              <a
                href="https://mc.coupang.com/ssr/desktop/order/list"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-blue-600 underline"
              >
                <span>주문목록</span>
                <ExternalLink className="h-4 w-4" />
              </a>{" "}
              → 상품선택 → [교환, 반품 신청] 선택
            </p>
            <p>• 이후 각 단계에 해당하는 항목을 선택하여 신청을 완료합니다.</p>
          </div>
        </>
      ),
    },
    {
      id: "faq-2",
      question: "[환불] 반품 신청을 했는데, 언제 환불되나요?",
      answer: (
        <p>
          환불은 결제수단에 따라 다소 시간이 소요될 수 있습니다. (답변 예시)
        </p>
      ),
    },
    {
      id: "faq-3",
      question: "[배송완료미수령] 상품을 받지 못했는데 배송완료로 확인됩니다.",
      answer: (
        <p>
          배송 기사님께 연락하거나 고객센터로 문의해 주시기 바랍니다. (답변
          예시)
        </p>
      ),
    },
    {
      id: "faq-4",
      question: "[교환/반품] 상품을 교환/반품하고 싶어요.",
      answer: (
        <p>
          마이쿠팡 {">"} 주문목록에서 직접 신청하실 수 있습니다. (답변 예시)
        </p>
      ),
    },
  ]
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: t("trackDelivery"),
      }}
    >
      <MypageLayout>
        <div className="bg-gray min-h-screen py-4">
          <DeliveryHeader
            currentStep={currentStep}
            completedDate={completedDate ? formatDate(completedDate, DATE_FORMATS.KO_DOT) : undefined}
          />

          <div className="px-3 md:px-0">
            {/* 주문목록으로 돌아가기 */}
            <section className="mt-4">
              <a
                href="/mypage/order/list"
                className="flex items-center gap-1 text-sm text-[#ffa500] hover:underline"
              >
                {tOrderActions("backToList")}
              </a>
            </section>

            {/* 배송 정보 */}
            <section className="mt-10">
              <h3 className="mb-3 px-3 text-sm font-bold text-gray-800">
                {tDelivery("trackingInfo")}
              </h3>
              {tracking && tracking.shipments.length > 0 ? (
                <div className="space-y-3">
                  {tracking.shipments.map((shipment, idx) => (
                    <div key={idx} className="rounded-xl bg-white p-4 shadow-sm">
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">{tDelivery("carrierLabel")}</span>
                          <span className="font-medium">
                            {shipment.carrierName && shipment.carrierName !== 'UNKNOWN'
                              ? shipment.carrierName
                              : tDelivery("unknownCarrier")}
                          </span>
                        </div>
                        {shipment.trackingNumber && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">{tDelivery("trackingNumberLabel")}</span>
                            <span className="font-mono">{shipment.trackingNumber}</span>
                          </div>
                        )}
                        {shipment.shippedAt && (
                          <div className="flex justify-between">
                            <span className="text-gray-500">{tDelivery("shippedAtLabel")}</span>
                            <span>{formatDate(shipment.shippedAt, DATE_FORMATS.KO_DOT)}</span>
                          </div>
                        )}
                      </div>
                      {shipment.trackingUrl && (
                        <a
                          href={shipment.trackingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-gray-300 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          {tDelivery("viewTracking")}
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      {shipment.trackingEvents.length > 0 && (
                        <div className="mt-3 border-t pt-3">
                          <div className="space-y-2">
                            {shipment.trackingEvents.slice(0, 5).map((evt, i) => (
                              <div key={i} className="flex gap-3 text-xs text-gray-600">
                                <span className="w-32 shrink-0 text-gray-400">
                                  {formatDate(evt.timestamp, "MM.dd HH:mm")}
                                </span>
                                <span>{evt.location ?? evt.status}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl bg-white p-4 text-center text-sm text-gray-500 shadow-sm">
                  {tDelivery("noTrackingInfo")}
                </div>
              )}
            </section>

            <section className="mt-6">
              <OrderInfoCardShipping />
            </section>

            <section className="mt-10 bg-white">
              <div className="p-3">
                <h3 className="mb-4 text-xl font-bold">
                  배송에 대해 궁금한 점이 있으십니까?
                </h3>
                <Accordion.Root defaultValue="faq-1">
                  {faqData.map((faq) => (
                    <Accordion.Item key={faq.id} value={faq.id}>
                      <Accordion.Trigger value={faq.id}>
                        {faq.question}
                      </Accordion.Trigger>
                      <Accordion.Content value={faq.id}>
                        {faq.answer}
                      </Accordion.Content>
                    </Accordion.Item>
                  ))}
                </Accordion.Root>
              </div>
            </section>
          </div>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
