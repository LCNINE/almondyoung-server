"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, Clock3, FileText, RefreshCw } from "lucide-react"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import type { PendingDigitalOrder } from "../pending-orders"

export function PendingDownloadNotice({
  hasPendingOrders,
  unavailable,
}: {
  hasPendingOrders: boolean
  unavailable: boolean
}) {
  if (!hasPendingOrders && !unavailable) return null

  const Icon = unavailable ? AlertCircle : Clock3

  return (
    <div
      role="status"
      className="mb-7 flex gap-3 rounded-xl border border-orange-200 bg-orange-50/50 p-5 md:gap-4 md:p-6"
    >
      <Icon
        className="mt-0.5 size-6 shrink-0 text-amber-600"
        aria-hidden="true"
      />
      <div>
        <h2 className="mb-2 text-sm font-semibold break-keep md:text-base">
          {unavailable
            ? "최근 결제 내역의 반영 상태를 확인하지 못했어요."
            : "결제가 완료되었어요. 다운로드를 준비하고 있습니다."}
        </h2>
        <p className="text-sm leading-7 break-keep text-amber-900/80">
          {unavailable ? (
            "이미 보유한 상품은 아래에서 이용하실 수 있어요. 잠시 후 ‘다시 확인하기’를 눌러주세요."
          ) : (
            <>
              구매 내역이 반영되기까지 <strong>최대 5분 정도</strong> 걸릴 수
              있어요.
              <br />
              잠시 후 아래 ‘다시 확인하기’를 눌러주세요.
            </>
          )}
        </p>
      </div>
    </div>
  )
}

export function PendingDownloadOrders({
  orders,
  unavailable,
}: {
  orders: PendingDigitalOrder[]
  unavailable: boolean
}) {
  const router = useRouter()
  const [isRefreshing, startTransition] = useTransition()
  const [hasRefreshed, setHasRefreshed] = useState(false)

  if (orders.length === 0 && !unavailable) return null

  const handleRefresh = () => {
    setHasRefreshed(true)

    startTransition(() => {
      router.refresh()
    })
  }

  return (
    <section
      className="mb-8"
      aria-label="결제 반영 대기 상품"
      aria-busy={isRefreshing}
    >
      <div className="space-y-4">
        {orders.map((order) => (
          <article
            key={order.id}
            className="overflow-hidden rounded-xl border border-gray-200"
          >
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500 md:px-5">
              <LocalizedClientLink
                href={`/mypage/order/details?orderId=${encodeURIComponent(order.id)}`}
                className="font-medium text-gray-600 underline-offset-4 hover:underline"
              >
                주문 #{order.display_id ?? order.id}
              </LocalizedClientLink>
              <span>결제 완료 · 반영 대기</span>
            </div>

            <div className="divide-y divide-gray-100">
              {order.items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center gap-4 p-4 md:flex-nowrap md:gap-5 md:p-6"
                >
                  <div className="flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100">
                    {item.thumbnail ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={getThumbnailUrl(item.thumbnail)}
                        alt=""
                        className="size-full object-cover"
                      />
                    ) : (
                      <FileText
                        className="size-8 text-gray-400"
                        aria-hidden="true"
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="mb-2 text-xs text-gray-400">디지털 상품</p>
                    <h3 className="mb-3 text-sm leading-6 font-semibold break-keep">
                      {item.title || "디지털 상품"}
                    </h3>
                    <span className="inline-flex items-center gap-1.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
                      <span className="size-1 rounded-full bg-current" />
                      결제 완료 · 반영 대기
                    </span>
                  </div>

                  <div className="w-full shrink-0 text-center md:w-36">
                    <Button disabled variant="outline" className="w-full">
                      다운로드 준비 중
                    </Button>
                    <p className="mt-2 hidden text-[11px] text-gray-400 md:block">
                      구매 내역 반영 후 이용 가능
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>

      <div className="py-6 text-center">
        <Button
          variant="outline"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw
            className={isRefreshing ? "size-4 animate-spin" : "size-4"}
            aria-hidden="true"
          />
          {isRefreshing ? "확인 중…" : "다시 확인하기"}
        </Button>
        <p className="mt-3 text-xs leading-6 text-gray-500" role="status">
          {isRefreshing
            ? "구매 내역을 확인하고 있어요."
            : hasRefreshed && !unavailable
              ? "아직 반영 중입니다. 잠시 후 다시 확인해 주세요."
              : "다시 결제하지 않으셔도 됩니다."}
        </p>
      </div>

      <p className="border-t border-gray-100 pt-5 text-xs leading-6 text-gray-500">
        5분이 지나도 상품이 보이지 않나요?
        <br />
        주문번호와 함께{" "}
        <LocalizedClientLink
          href="/cs"
          className="underline underline-offset-4"
        >
          고객센터에 문의
        </LocalizedClientLink>
        해 주세요.
      </p>
    </section>
  )
}
