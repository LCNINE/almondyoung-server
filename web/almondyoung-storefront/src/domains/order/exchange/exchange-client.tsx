"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { PageTitle } from "@/components/shared/page-title"
import {
  createExchangeRequestByMedusaId,
  createReturnRequestByMedusaId,
  getOrderActionsByMedusaId,
  getOrderLinesByMedusaId,
  type CreateExchangeRequestLineDto,
  type CreateReturnRequestLineDto,
  type ExchangeReasonCode,
  type ReturnReasonCode,
  type StoreOrderLine,
} from "@/lib/api/orders/store-orders"
import { useTranslations } from "next-intl"
import { useCallback, useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

interface ExchangeClientProps {
  orderId?: string
  type: "return" | "exchange"
}

type ReasonCode = ReturnReasonCode

const REASON_CODES: ReasonCode[] = [
  "defective",
  "not_as_described",
  "change_of_mind",
  "wrong_item",
  "damaged_in_shipping",
  "other",
]

const REASON_KEY_MAP: Record<ReasonCode, string> = {
  defective: "reasonDefective",
  not_as_described: "reasonNotAsDescribed",
  change_of_mind: "reasonChangeOfMind",
  wrong_item: "reasonWrongItem",
  damaged_in_shipping: "reasonDamagedInShipping",
  other: "reasonOther",
}

interface LineSelection {
  lineId: string
  selected: boolean
  quantity: number
  maxQuantity: number
}

interface ReturnAddress {
  name: string
  phone: string
  postcode: string
  address: string
  addressDetail: string
}

type PageState = "loading" | "not_allowed" | "form" | "success" | "error"

export function ExchangeClient({ orderId, type }: ExchangeClientProps) {
  const t = useTranslations("mypage.order.exchange")

  const [pageState, setPageState] = useState<PageState>("loading")
  const [lines, setLines] = useState<StoreOrderLine[]>([])
  const [lineSelections, setLineSelections] = useState<LineSelection[]>([])
  const [reason, setReason] = useState<ReasonCode | "">("")
  const [reasonDetail, setReasonDetail] = useState("")
  const [returnAddress, setReturnAddress] = useState<ReturnAddress>({
    name: "",
    phone: "",
    postcode: "",
    address: "",
    addressDetail: "",
  })
  const [isPending, startTransition] = useTransition()

  const loadData = useCallback(async () => {
    if (!orderId) {
      setPageState("not_allowed")
      return
    }

    try {
      const [actionsResult, linesResult] = await Promise.allSettled([
        getOrderActionsByMedusaId(orderId),
        getOrderLinesByMedusaId(orderId),
      ])

      const actions =
        actionsResult.status === "fulfilled" ? actionsResult.value : null
      const linesData =
        linesResult.status === "fulfilled" ? linesResult.value : null

      const actionKey = type === "return" ? "return" : "exchange"
      const allowed = actions?.availableActions?.includes(actionKey) ?? false

      if (!allowed) {
        setPageState("not_allowed")
        return
      }

      if (!linesData || linesData.lines.length === 0) {
        setPageState("error")
        return
      }

      setLines(linesData.lines)
      setLineSelections(
        linesData.lines.map((l) => ({
          lineId: l.id,
          selected: false,
          quantity: 1,
          maxQuantity: l.quantity,
        }))
      )
      setPageState("form")
    } catch {
      setPageState("error")
    }
  }, [orderId, type])

  useEffect(() => {
    loadData()
  }, [loadData])

  const toggleLine = (lineId: string) => {
    setLineSelections((prev) =>
      prev.map((s) => (s.lineId === lineId ? { ...s, selected: !s.selected } : s))
    )
  }

  const setLineQuantity = (lineId: string, qty: number) => {
    setLineSelections((prev) =>
      prev.map((s) => {
        if (s.lineId !== lineId) return s
        return { ...s, quantity: Math.max(1, Math.min(qty, s.maxQuantity)) }
      })
    )
  }

  const handleSubmit = () => {
    const selectedLines = lineSelections.filter((s) => s.selected)

    if (selectedLines.length === 0) {
      toast.error(t("selectAtLeastOne"))
      return
    }
    if (!reason) {
      toast.error(t("selectReason"))
      return
    }

    startTransition(async () => {
      try {
        if (type === "return") {
          const returnLines: CreateReturnRequestLineDto[] = selectedLines.map((s) => ({
            salesOrderLineId: s.lineId,
            quantity: s.quantity,
          }))
          await createReturnRequestByMedusaId(orderId!, {
            lines: returnLines,
            reasonCode: reason as ReturnReasonCode,
            reasonDetail: reasonDetail.trim() || undefined,
            returnAddress:
              returnAddress.name || returnAddress.address
                ? returnAddress
                : undefined,
          })
        } else {
          const exchangeLines: CreateExchangeRequestLineDto[] = selectedLines.map((s) => ({
            salesOrderLineId: s.lineId,
            quantity: s.quantity,
          }))
          await createExchangeRequestByMedusaId(orderId!, {
            lines: exchangeLines,
            reasonCode: reason as ExchangeReasonCode,
            reasonDetail: reasonDetail.trim() || undefined,
          })
        }
        setPageState("success")
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : undefined
        toast.error(message ?? t("loadError"))
      }
    })
  }

  if (!orderId) {
    return (
      <div className="bg-white px-3 py-8 md:min-h-screen md:px-6">
        <p className="text-sm text-gray-500">{t("noOrderId")}</p>
        <div className="mt-4">
          <LocalizedClientLink href="/mypage/order/list">
            <CustomButton variant="outline" color="secondary" size="md">
              {t("backToOrders")}
            </CustomButton>
          </LocalizedClientLink>
        </div>
      </div>
    )
  }

  if (pageState === "loading") {
    return (
      <div className="flex min-h-[200px] items-center justify-center bg-white px-3 py-8 md:px-6">
        <p className="text-sm text-gray-400">...</p>
      </div>
    )
  }

  if (pageState === "not_allowed") {
    return (
      <div className="bg-white px-3 py-8 md:min-h-screen md:px-6">
        <PageTitle>{type === "return" ? t("formReturnTitle") : t("formExchangeTitle")}</PageTitle>
        <div className="mt-6 rounded-lg border border-gray-200 p-5">
          <p className="font-medium text-gray-800">{t("notAllowed")}</p>
          <p className="mt-2 text-sm text-gray-500">{t("notAllowedDetail")}</p>
        </div>
        <div className="mt-6">
          <LocalizedClientLink href="/mypage/order/list">
            <CustomButton variant="outline" color="secondary" size="md">
              {t("backToOrders")}
            </CustomButton>
          </LocalizedClientLink>
        </div>
      </div>
    )
  }

  if (pageState === "error") {
    return (
      <div className="bg-white px-3 py-8 md:min-h-screen md:px-6">
        <p className="text-sm text-red-500">{t("loadError")}</p>
        <div className="mt-4">
          <LocalizedClientLink href="/mypage/order/list">
            <CustomButton variant="outline" color="secondary" size="md">
              {t("backToOrders")}
            </CustomButton>
          </LocalizedClientLink>
        </div>
      </div>
    )
  }

  if (pageState === "success") {
    return (
      <div className="bg-white px-3 py-8 md:min-h-screen md:px-6">
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-lg font-bold text-green-600">{t("successTitle")}</p>
          <p className="text-sm text-gray-600">
            {type === "return" ? t("successReturn") : t("successExchange")}
          </p>
          <LocalizedClientLink href="/mypage/order/list">
            <CustomButton variant="fill" color="primary" size="md">
              {t("backToOrders")}
            </CustomButton>
          </LocalizedClientLink>
        </div>
      </div>
    )
  }

  // form state
  return (
    <div className="bg-white px-3 py-4 md:min-h-screen md:px-6">
      <PageTitle>{type === "return" ? t("formReturnTitle") : t("formExchangeTitle")}</PageTitle>

      <div className="mt-4 space-y-6">
        {/* 상품 선택 */}
        <section>
          <h2 className="mb-3 text-sm font-bold text-gray-800">{t("linesTitle")}</h2>
          {lines.length === 0 ? (
            <p className="text-sm text-gray-500">{t("noLines")}</p>
          ) : (
            <div className="space-y-2">
              {lines.map((line, idx) => {
                const sel = lineSelections[idx]
                if (!sel) return null
                return (
                  <div
                    key={line.id}
                    className={`rounded-lg border p-3 transition ${sel.selected ? "border-black bg-gray-50" : "border-gray-200 bg-white"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-800">{line.productName}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {t("lineQuantity")}: {line.quantity}
                          {line.unitPrice != null && (
                            <span className="ml-2">{line.unitPrice.toLocaleString()}원</span>
                          )}
                        </p>
                      </div>
                      <CustomButton
                        type="button"
                        variant={sel.selected ? "fill" : "outline"}
                        color="secondary"
                        size="xs"
                        fullWidth={false}
                        onClick={() => toggleLine(line.id)}
                      >
                        {sel.selected ? t("lineDeselect") : t("lineSelect")}
                      </CustomButton>
                    </div>
                    {sel.selected && (
                      <div className="mt-3 flex items-center gap-2">
                        <label className="text-xs text-gray-600">{t("requestQuantity")}</label>
                        <input
                          type="number"
                          min={1}
                          max={sel.maxQuantity}
                          value={sel.quantity}
                          onChange={(e) => setLineQuantity(line.id, Number(e.target.value))}
                          className="w-16 rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                        <span className="text-xs text-gray-400">{t("maxQuantity", { max: sel.maxQuantity })}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* 사유 선택 */}
        <section>
          <h2 className="mb-3 text-sm font-bold text-gray-800">{t("reasonTitle")}</h2>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {REASON_CODES.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setReason(code)}
                className={`rounded-lg border px-3 py-2 text-sm transition ${
                  reason === code
                    ? "border-black bg-black text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-400"
                }`}
              >
                {t(REASON_KEY_MAP[code] as Parameters<typeof t>[0])}
              </button>
            ))}
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-xs text-gray-600">{t("reasonDetail")}</label>
            <textarea
              maxLength={500}
              value={reasonDetail}
              onChange={(e) => setReasonDetail(e.target.value)}
              placeholder={t("reasonDetailPlaceholder")}
              rows={3}
              className="w-full rounded-lg border border-gray-200 p-3 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
            />
          </div>
        </section>

        {/* 반품 수거 주소 (return only) */}
        {type === "return" && (
          <section>
            <h2 className="mb-3 text-sm font-bold text-gray-800">{t("returnAddressTitle")}</h2>
            <div className="space-y-2">
              {(
                [
                  ["name", t("returnAddressName")],
                  ["phone", t("returnAddressPhone")],
                  ["postcode", t("returnAddressPostcode")],
                  ["address", t("returnAddressAddress")],
                  ["addressDetail", t("returnAddressDetail")],
                ] as const
              ).map(([field, label]) => (
                <div key={field}>
                  <label className="mb-0.5 block text-xs text-gray-500">{label}</label>
                  <input
                    type="text"
                    value={returnAddress[field]}
                    onChange={(e) =>
                      setReturnAddress((prev) => ({ ...prev, [field]: e.target.value }))
                    }
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 제출 버튼 */}
        <div className="pb-6">
          <CustomButton
            type="button"
            variant="fill"
            color="primary"
            size="lg"
            fullWidth
            isLoading={isPending}
            disabled={isPending}
            onClick={handleSubmit}
          >
            {isPending
              ? t("submitting")
              : type === "return"
                ? t("submitReturn")
                : t("submitExchange")}
          </CustomButton>
        </div>
      </div>
    </div>
  )
}
