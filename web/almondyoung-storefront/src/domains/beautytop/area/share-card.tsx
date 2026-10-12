"use client"

import { useTranslations } from "next-intl"
import { useScopeLabel } from "../use-scope"
import { useState } from "react"
import type { Filters } from "../components/neighborhood-tab"
import type { BeautyTopOptions, BeautyTopPrice } from "../types"
import { useArea } from "../use-area"
import { useNumberFormats } from "../use-number-formats"
import { useMarketSummary } from "./use-market-summary"
import { CardSkeleton } from "../components/parts"

const W = 1080
const H = 1350
const FONT = "Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif"

type Line = { label: string; value: string }

// Drawn in the browser with the page's own font: no server work, no image service.
async function drawCard(
  title: string,
  eyebrow: string,
  lines: Line[],
  brand: string,
  tagline: string
): Promise<Blob | null> {
  await document.fonts.ready
  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const c = canvas.getContext("2d")
  if (!c) return null
  c.fillStyle = "#f3f4f5"
  c.fillRect(0, 0, W, H)
  c.fillStyle = "#ffffff"
  c.beginPath()
  c.roundRect(64, 64, W - 128, H - 128, 48)
  c.fill()
  c.fillStyle = "#757575"
  c.font = `500 36px ${FONT}`
  c.fillText(eyebrow, 128, 200)
  c.fillStyle = "#000000"
  c.font = `700 72px ${FONT}`
  title.split("\n").forEach((part, i) => c.fillText(part, 128, 310 + i * 96))
  lines.forEach((line, i) => {
    const y = 560 + i * 128
    c.fillStyle = "#4d4d4d"
    c.font = `400 40px ${FONT}`
    c.fillText(line.label, 128, y)
    c.fillStyle = "#000000"
    c.font = `700 44px ${FONT}`
    c.textAlign = "right"
    c.fillText(line.value, W - 128, y)
    c.textAlign = "left"
    c.fillStyle = "#ececec"
    c.fillRect(128, y + 40, W - 256, 2)
  })
  c.fillStyle = "#ffa500"
  c.fillRect(128, H - 300, 96, 8)
  c.fillStyle = "#000000"
  c.font = `700 40px ${FONT}`
  c.fillText(brand, 128, H - 220)
  c.fillStyle = "#757575"
  c.font = `400 32px ${FONT}`
  c.fillText(tagline, 128, H - 168)
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"))
}

export function ShareCard({
  filters,
  options,
}: {
  filters: Filters
  options: BeautyTopOptions
}) {
  const t = useTranslations("beautytop.share")
  const fmt = useNumberFormats()
  const region = useScopeLabel(filters)
  const summary = useMarketSummary(filters, options)
  const market = summary.data
  const prices = useArea<BeautyTopPrice>("prices", filters, !!filters.gugun)
  const median = prices.data?.groups?.find((g) => typeof g.median === "number")
  const [status, setStatus] = useState<"idle" | "saved" | "copied" | "failed">(
    "idle"
  )

  if (
    summary.isPending ||
    (market?.available && !!filters.gugun && prices.isPending)
  )
    return <CardSkeleton />
  if (!market?.available || !market.shops) return null

  const lines: Line[] = [
    ...(typeof market.opened_last_year === "number"
      ? [
          {
            label: t("opened"),
            value: t("shops", { count: fmt.full(market.opened_last_year) }),
          },
        ]
      : []),
    ...(market.residents_per_shop
      ? [
          {
            label: t("residents"),
            value: t("people", {
              count: fmt.full(Math.round(market.residents_per_shop)),
            }),
          },
        ]
      : []),
    ...(median?.median
      ? [
          {
            label: t("median", { name: median.name }),
            value: t("won", { value: fmt.full(median.median) }),
          },
        ]
      : []),
  ]
  const title = t("title", {
    gugun: region,
    category: filters.category,
    count: fmt.full(market.shops),
  })
  const tagline = t(filters.sido ? "tagline" : "nationalBasis")
  const link = () => {
    const url = new URL(window.location.href)
    url.search = new URLSearchParams(filters).toString()
    url.hash = ""
    return url.toString()
  }

  const saveImage = async () => {
    try {
      const blob = await drawCard(
        title,
        t("eyebrow", { sido: region }),
        lines,
        t("brand"),
        tagline
      )
      if (!blob) throw new Error("canvas")
      const file = new File([blob], "beautytop.png", { type: "image/png" })
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], url: link() })
      } else {
        const a = document.createElement("a")
        a.href = URL.createObjectURL(blob)
        a.download = file.name
        a.click()
        URL.revokeObjectURL(a.href)
      }
      setStatus("saved")
    } catch (error) {
      // Closing the share sheet is not a failure.
      setStatus(
        error instanceof DOMException && error.name === "AbortError"
          ? "idle"
          : "failed"
      )
    }
  }

  const shareLink = async () => {
    try {
      if (navigator.share)
        await navigator.share({ title: title.replace("\n", " "), url: link() })
      else {
        await navigator.clipboard.writeText(link())
        setStatus("copied")
      }
    } catch (error) {
      setStatus(
        error instanceof DOMException && error.name === "AbortError"
          ? "idle"
          : "failed"
      )
    }
  }

  return (
    <section aria-labelledby="share-title" className="flex flex-col gap-4">
      <h2 id="share-title" className="text-lg font-bold">
        {t("heading")}
      </h2>
      <div className="bg-secondary rounded-2xl p-4">
        <div className="bg-background flex flex-col gap-5 rounded-2xl p-6 shadow-[0_2px_10px_rgba(0,0,0,.1)]">
          <div className="flex flex-col gap-1">
            <span className="text-muted-foreground text-sm">
              {t("eyebrow", { sido: region })}
            </span>
            <span className="text-[26px] leading-[35px] font-bold whitespace-pre-line">
              {title}
            </span>
          </div>
          <dl className="flex flex-col text-base">
            {lines.map((line) => (
              <div
                key={line.label}
                className="border-border flex justify-between border-b py-3 last:border-0"
              >
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd className="font-bold tabular-nums">{line.value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-col gap-0.5">
            <span className="bg-primary mb-2 h-1 w-8" />
            <span className="text-sm font-bold">{t("brand")}</span>
            <span className="text-muted-foreground text-xs">{tagline}</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={saveImage}
          className="bg-secondary hover:bg-border h-12 rounded-lg text-sm font-medium transition-colors duration-150"
        >
          {t("save")}
        </button>
        <button
          type="button"
          onClick={shareLink}
          className="bg-secondary hover:bg-border h-12 rounded-lg text-sm font-medium transition-colors duration-150"
        >
          {t("link")}
        </button>
      </div>
      <p className="text-muted-foreground min-h-4 text-xs" aria-live="polite">
        {status === "idle" ? "" : t(`status.${status}`)}
      </p>
    </section>
  )
}
