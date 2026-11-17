import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@components/layout"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Check, ChevronDown, ExternalLink } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { getOrder } from "@/lib/api/medusa/orders"
import { retrieveCustomer } from "@/lib/api/medusa/customer"
import {
  getOrderTrackingByMedusaId,
  type StoreOrderTrackingResponse,
} from "@/lib/api/orders/store-orders"
import { ApiAuthError } from "@lib/api/api-error"
import { buildAddressLine } from "@/lib/utils/address-line"
import { cn } from "@/lib/utils"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import { CopyButton } from "./copy-button"

interface OrderTrackPageProps {
  searchParams: Promise<{ orderId?: string }>
}

const CS_PHONE = "1877-7184"
const STEP_KEYS = ["paid", "preparing", "shippingStarted", "shipping", "delivered"] as const
const FAQ_KEYS = ["partial", "notReceived", "return"] as const

function toStep(tracking: StoreOrderTrackingResponse | null): number {
  switch (tracking?.status) {
    case "preparing":
      return 2
    case "shipping":
      return tracking.shipments.some((s) => s.trackingEvents.length > 0) ? 4 : 3
    case "delivered":
      return 5
    default:
      return 1
  }
}

export default async function OrderTrackPage({ searchParams }: OrderTrackPageProps) {
  const t = await getTranslations("mypage.order.delivery")
  const tPage = await getTranslations("mypage.page")
  const { orderId } = await searchParams

  const [rawOrder, customer, tracking] = await Promise.all([
    orderId ? getOrder(orderId) : Promise.resolve(null),
    retrieveCustomer(),
    orderId
      ? getOrderTrackingByMedusaId(orderId).catch((error: unknown) => {
          if (error instanceof ApiAuthError) throw error

          return null
        })
      : Promise.resolve(null),
  ])

  // /store/orders/:id 는 주인을 가리지 않으므로 남의 주문이면 받는 분을 그리지 않는다
  const order =
    rawOrder?.customer_id && customer?.id === rawOrder.customer_id ? rawOrder : null
  const address = order?.shipping_address
  const shipments = tracking?.shipments ?? []
  const step = toStep(tracking)
  const eta = shipments.find((s) => s.eta)?.eta
  const deliveredAt = shipments.find((s) => s.deliveredAt)?.deliveredAt
  const heroDate = (value: string) => formatDate(value, DATE_FORMATS.KO_MONTH_DAY_WEEKDAY)

  const hero =
    step === 5
      ? { title: deliveredAt ? t("deliveredTitle", { date: heroDate(deliveredAt) }) : t("deliveredTitleNoDate") }
      : step >= 3
        ? {
            title: t("shippingTitle"),
            description: eta ? t("shippingEta", { date: heroDate(eta) }) : t("shippingDescription"),
          }
        : { title: t(step === 2 ? "preparingTitle" : "paidTitle"), description: t("waitingDescription") }

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: tPage("trackDelivery"),
      }}
    >
      <MypageLayout>
        <div className="bg-muted min-h-screen md:bg-transparent">
          <section className="border-secondary border-b bg-white px-4 pt-6 pb-5 md:rounded-lg md:border">
            <h2 className="text-xl font-bold">{hero.title}</h2>
            {hero.description && (
              <p className="text-muted-foreground mt-1 text-sm">{hero.description}</p>
            )}
            <ol className="mt-6 flex items-start">
              {STEP_KEYS.map((key, index) => {
                const id = index + 1
                const done = id < step
                const current = id === step

                return (
                  <li key={key} className={cn("flex items-start", index > 0 && "flex-1")}>
                    {index > 0 && (
                      <div className={cn("mt-3 h-0.5 flex-1", done || current ? "bg-foreground" : "bg-secondary")} />
                    )}
                    <div className="flex w-12 flex-col items-center gap-2">
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                          done && "bg-foreground text-white",
                          current && "bg-primary text-white ring-4 ring-mint-tint",
                          !done && !current && "bg-secondary text-[#b0b3ba]"
                        )}
                      >
                        {done ? <Check className="h-3.5 w-3.5" /> : id}
                      </span>
                      <span
                        className={cn(
                          "text-center text-xs break-keep",
                          current ? "font-bold" : done ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        {t(key)}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>

          <div className="flex flex-col gap-3 p-4 md:px-0">
            <h3 className="mt-2 text-base font-bold">{t("trackingInfo")}</h3>
            {shipments.length > 0 ? (
              shipments.map((shipment) => (
                <div key={shipment.fulfillmentOrderId} className="border-border rounded-lg border bg-white p-4 text-sm">
                  <dl className="space-y-2">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{t("carrierLabel")}</dt>
                      <dd>
                        {shipment.carrierName && shipment.carrierName !== "UNKNOWN"
                          ? shipment.carrierName
                          : t("unknownCarrier")}
                      </dd>
                    </div>
                    {shipment.trackingNumber && (
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-muted-foreground">{t("trackingNumberLabel")}</dt>
                        <dd className="flex items-center tabular-nums">
                          {shipment.trackingNumber}
                          <CopyButton value={shipment.trackingNumber} />
                        </dd>
                      </div>
                    )}
                    {shipment.shippedAt && (
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{t("shippedAtLabel")}</dt>
                        <dd>{formatDate(shipment.shippedAt, DATE_FORMATS.KO_DOT)}</dd>
                      </div>
                    )}
                  </dl>

                  {shipment.trackingEvents.length > 0 && (
                    <ol className="border-secondary mt-4 border-t pt-4">
                      {shipment.trackingEvents.slice(0, 5).map((event, index) => (
                        <li key={index} className="relative flex gap-3 pb-4 pl-5 last:pb-0">
                          <span
                            className={cn(
                              "absolute top-1.5 left-1 h-2 w-2 rounded-full",
                              index === 0 ? "bg-foreground" : "bg-border"
                            )}
                          />
                          <span className="text-muted-foreground w-20 shrink-0 text-[13px]">
                            {formatDate(event.timestamp, "MM.dd HH:mm")}
                          </span>
                          <span className={cn(index === 0 && "font-bold")}>
                            {event.location ?? event.status}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}

                  {shipment.trackingUrl && (
                    <a
                      href={shipment.trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border-border active:bg-secondary mt-4 flex h-11 items-center justify-center gap-1.5 rounded-lg border font-medium"
                    >
                      {t("viewTracking")}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              ))
            ) : (
              <div className="border-border rounded-lg border bg-white px-4 py-6 text-center text-sm">
                <p className="font-medium">{t("emptyTitle")}</p>
                <p className="text-muted-foreground mt-1">{t("emptyDescription")}</p>
              </div>
            )}

            {address && (
              <>
                <h3 className="mt-2 text-base font-bold">{t("receiver")}</h3>
                <dl className="border-border space-y-2 rounded-lg border bg-white p-4 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground shrink-0">{t("receiverName")}</dt>
                    <dd>{[address.first_name, address.last_name].filter(Boolean).join(" ") || "-"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground shrink-0">{t("receiverPhone")}</dt>
                    <dd>{address.phone || "-"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground shrink-0">{t("receiverAddress")}</dt>
                    <dd className="text-right">
                      {buildAddressLine({
                        province: address.province,
                        city: address.city,
                        address1: address.address_1,
                        address2: address.address_2,
                      }) || "-"}
                    </dd>
                  </div>
                </dl>
              </>
            )}

            <h3 className="mt-2 text-base font-bold">{t("faqTitle")}</h3>
            <div className="border-border rounded-lg border bg-white px-4 text-sm">
              {FAQ_KEYS.map((key) => (
                <details key={key} className="group border-secondary border-t first:border-t-0">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 font-medium [&::-webkit-details-marker]:hidden">
                    {t(`faq.${key}Q`)}
                    <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="bg-muted mb-4 rounded-lg p-3 leading-relaxed">{t(`faq.${key}A`)}</p>
                </details>
              ))}
            </div>

            <div className="flex gap-2">
              <LocalizedClientLink
                href="/cs?tab=inquiry"
                className="border-border active:bg-secondary flex h-11 flex-1 items-center justify-center rounded-lg border bg-white text-sm font-medium"
              >
                {t("inquiry")}
              </LocalizedClientLink>
              <a
                href={`tel:${CS_PHONE.replaceAll("-", "")}`}
                className="border-border active:bg-secondary flex h-11 flex-1 items-center justify-center rounded-lg border bg-white text-sm font-medium"
              >
                {t("csCall", { phone: CS_PHONE })}
              </a>
            </div>
          </div>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}
