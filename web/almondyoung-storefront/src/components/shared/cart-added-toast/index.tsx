"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { useCart } from "@/contexts/cart-context"
import { useShippingGroups } from "@/contexts/shipping-groups-context"
import { buildFreeShippingProgress } from "@/domains/cart/utils/build-free-shipping-progress"
import { resolveShippingGroupCodeFromMetadata } from "@/lib/api/medusa/shipping-group-types"
import { cn } from "@/lib/utils"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { formatPrice } from "@/lib/utils/price-utils"
import Image from "next/image"
import { useTranslations } from "next-intl"
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react"

import {
  getCartAddedToast,
  getServerCartAddedToast,
  hideCartAddedToast,
  subscribeCartAddedToast,
} from "./store"

export { showCartAddedToast } from "./store"

const DURATION = 5000
const EXIT_DURATION = 200
const DESKTOP_QUERY = "(min-width: 1280px)"

// PC 는 헤더 장바구니 아이콘 바로 아래, 헤더가 화면 밖이면 오른쪽 위에 붙인다
function anchorStyle(): CSSProperties {
  const anchors = document.querySelectorAll<HTMLElement>("[data-cart-anchor]")
  const anchor = Array.from(anchors).find((el) => el.offsetParent !== null)
  const rect = anchor?.getBoundingClientRect()

  if (!rect || rect.bottom <= 0) return { top: 16, right: 16 }

  return {
    top: rect.bottom + 10,
    right: Math.max(16, window.innerWidth - rect.right - 8),
  }
}

export function CartAddedToastHost() {
  const toast = useSyncExternalStore(
    subscribeCartAddedToast,
    getCartAddedToast,
    getServerCartAddedToast
  )
  const t = useTranslations("cart.addedToast")
  const { cart } = useCart()
  const groups = useShippingGroups()
  const [exiting, setExiting] = useState(false)
  const [paused, setPaused] = useState(false)
  const [desktopStyle, setDesktopStyle] = useState<CSSProperties | null>(null)
  const remaining = useRef(DURATION)
  const startedAt = useRef(0)
  const timer = useRef<number | null>(null)

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  const close = useCallback(() => {
    clearTimer()
    setExiting(true)
    timer.current = window.setTimeout(() => {
      setExiting(false)
      hideCartAddedToast()
    }, EXIT_DURATION)
  }, [])

  const schedule = useCallback(
    (ms: number) => {
      clearTimer()
      remaining.current = ms
      startedAt.current = Date.now()
      timer.current = window.setTimeout(close, ms)
    },
    [close]
  )

  useEffect(() => {
    if (!toast) return

    setExiting(false)
    setPaused(false)
    setDesktopStyle(
      window.matchMedia(DESKTOP_QUERY).matches ? anchorStyle() : null
    )
    schedule(DURATION)

    return clearTimer
  }, [toast, schedule])

  if (!toast) return null

  const pause = () => {
    if (exiting) return
    clearTimer()
    remaining.current -= Date.now() - startedAt.current
    setPaused(true)
  }

  const resume = () => {
    if (exiting) return
    setPaused(false)
    schedule(Math.max(remaining.current, 600))
  }

  const entries = buildFreeShippingProgress(cart?.items, groups)
  const groupCode = resolveShippingGroupCodeFromMetadata(toast.productMetadata)
  const freeShipping =
    entries.find((entry) => entry.groupCode === groupCode) ??
    (entries.length === 1 ? entries[0] : null)
  const savings = toast.membershipSavings ?? 0
  const thumbnail = toast.thumbnail ? getThumbnailUrl(toast.thumbnail) : ""

  return (
    <div
      key={toast.key}
      role="status"
      aria-live="polite"
      onMouseEnter={pause}
      onMouseLeave={resume}
      style={desktopStyle ?? undefined}
      className={cn(
        "fixed z-[1000] w-[300px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl bg-white p-3 pr-3.5 shadow-[0_10px_30px_rgba(20,24,31,0.16),0_2px_6px_rgba(20,24,31,0.08)]",
        desktopStyle
          ? "origin-top-right"
          : "bottom-[calc(88px+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2",
        exiting
          ? cn(
              "animate-out fade-out duration-200",
              desktopStyle ? "zoom-out-95" : "slide-out-to-bottom-4"
            )
          : cn(
              "animate-in fade-in duration-300",
              desktopStyle ? "zoom-in-90" : "slide-in-from-bottom-6"
            )
      )}
    >
      <div className="grid grid-cols-[74px_1fr] items-center gap-x-[18px]">
        {thumbnail ? (
          <Image
            src={thumbnail}
            alt=""
            width={74}
            height={75}
            className="h-[75px] w-[74px] rounded-lg object-cover"
          />
        ) : (
          <span className="bg-muted h-[75px] w-[74px] rounded-lg" />
        )}

        <div className="flex min-w-0 flex-col gap-1">
          <p className="flex items-center gap-1.5 text-[15px] leading-[21px] font-bold tracking-[-0.15px] text-[#3baa64]">
            <svg
              viewBox="0 0 20.8 20.8"
              className="animate-in zoom-in-50 fade-in h-[20.8px] w-[20.8px] shrink-0 delay-100 duration-300"
              aria-hidden="true"
            >
              <circle cx="10.4" cy="10.4" r="10.4" fill="#3BAA64" />
              <path
                d="M16.2667 6.00005L8.2 14.0667L4.53333 10.4"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            {t("title")}
          </p>

          {savings > 0 && (
            <p className="text-[10px] leading-[15px] tracking-[-0.1px] text-black">
              {t("membershipSavings", { amount: formatPrice(savings) })}
            </p>
          )}

          {freeShipping && (
            <p className="text-muted-foreground text-[10px] leading-[15px] tracking-[-0.1px]">
              {freeShipping.reached
                ? t("freeShippingReached")
                : t.rich("freeShippingRemaining", {
                    amount: formatPrice(freeShipping.remaining),
                    b: (chunks) => (
                      <b className="text-primary font-bold">{chunks}</b>
                    ),
                  })}
            </p>
          )}

          <LocalizedClientLink
            href="/cart"
            onClick={() => {
              clearTimer()
              hideCartAddedToast()
            }}
            className="mt-1 inline-flex h-[38px] items-center self-start rounded-[5px] bg-[#3baa64] px-4 text-[12px] text-white hover:brightness-95"
          >
            {t("goToCart")}
          </LocalizedClientLink>
        </div>
      </div>

      <span
        aria-hidden="true"
        className="bg-primary absolute bottom-0 left-0 h-[3px] w-full origin-left"
        style={{
          animation: `cart-added-toast-drain ${DURATION}ms linear forwards`,
          animationPlayState: paused || exiting ? "paused" : "running",
        }}
      />
    </div>
  )
}
