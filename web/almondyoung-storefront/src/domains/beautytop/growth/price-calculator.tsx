"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useTranslations } from "next-intl"
import { useState, useRef, useEffect } from "react"
import { useNumberFormats } from "../use-number-formats"
import { calculatePriceScenario } from "./price-scenario"

export function PriceCalculator({
  focusRequested = false,
}: {
  focusRequested?: boolean
}) {
  const section = useRef<HTMLElement>(null)
  useEffect(() => {
    if (focusRequested) {
      section.current?.scrollIntoView({ block: "start" })
      section.current?.focus({ preventScroll: true })
    }
  }, [focusRequested])
  const t = useTranslations("beautytop.calculator")
  const fmt = useNumberFormats()
  const [currentPrice, setCurrentPrice] = useState("")
  const [nextPrice, setNextPrice] = useState("")
  const [visits, setVisits] = useState("")
  const [cost, setCost] = useState("")
  const [minutes, setMinutes] = useState("")
  const [example, setExample] = useState(false)
  const ready = currentPrice !== "" && nextPrice !== "" && visits !== ""
  const result = ready
    ? calculatePriceScenario({
        currentPrice: Number(currentPrice),
        nextPrice: Number(nextPrice),
        visits: Number(visits),
        variableCost: cost === "" ? null : Number(cost),
        minutes: minutes === "" ? null : Number(minutes),
      })
    : null
  const won = (value: number) =>
    t("won", { value: fmt.full(Math.round(value)) })
  const fields = [
    {
      key: "currentPrice",
      value: currentPrice,
      set: setCurrentPrice,
      max: 10_000_000,
    },
    { key: "nextPrice", value: nextPrice, set: setNextPrice, max: 10_000_000 },
    { key: "visits", value: visits, set: setVisits, max: 1_000_000 },
    { key: "cost", value: cost, set: setCost, max: 10_000_000 },
    { key: "minutes", value: minutes, set: setMinutes, max: 1440 },
  ]
  return (
    <section
      ref={section}
      tabIndex={-1}
      aria-labelledby="bt-calculator"
      className="bg-background border-border focus-visible:ring-ring flex scroll-mt-24 flex-col gap-4 rounded-xl border p-4 focus-visible:ring-2"
    >
      <h2 id="bt-calculator" className="text-xl font-bold">
        {t("title")}
      </h2>
      <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          className="w-fit"
          onClick={() => {
            setCurrentPrice("40000")
            setNextPrice("45000")
            setVisits("100")
            setCost("5000")
            setMinutes("60")
            setExample(true)
          }}
        >
          {t("example")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setCurrentPrice("")
            setNextPrice("")
            setVisits("")
            setCost("")
            setMinutes("")
            setExample(false)
          }}
        >
          {t("clear")}
        </Button>
      </div>
      {example && (
        <p className="text-muted-foreground text-xs">{t("exampleNotice")}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => (
          <label
            key={field.key}
            htmlFor={`bt-calc-${field.key}`}
            className="flex flex-col gap-2 text-sm font-medium"
          >
            {t(`input.${field.key}`)}
            <Input
              id={`bt-calc-${field.key}`}
              type="number"
              inputMode="decimal"
              min={field.key === "cost" ? 0 : 1}
              max={field.max}
              step={1}
              value={field.value}
              onChange={(event) => field.set(event.target.value)}
              className="h-12 text-base"
            />
          </label>
        ))}
      </div>
      <div aria-live="polite">
        {!ready ? (
          <p className="text-muted-foreground text-sm">{t("prompt")}</p>
        ) : !result ? (
          <p role="alert" className="text-destructive text-sm">
            {t("invalid")}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="bg-muted rounded-lg p-4">
              <p className="text-sm">
                {t("sameVisits", { visits: fmt.full(Number(visits)) })}
              </p>
              <p className="mt-2 text-[26px] leading-[35px] font-bold tabular-nums">
                {won(result.nextRevenue)}
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                {t("before", { amount: won(result.currentRevenue) })}
              </p>
            </div>
            <p className="text-base font-medium">
              {t("breakEven", {
                visits: fmt.full(result.revenueBreakEvenVisits),
              })}
            </p>
            <p className="text-muted-foreground text-sm">
              {t("changeVisits", {
                visits: fmt.full(
                  result.revenueBreakEvenVisits - Number(visits)
                ),
              })}
            </p>
            {result.nextContribution !== null && (
              <div className="border-border border-t pt-4">
                <p className="text-sm">
                  {t("contribution", { amount: won(result.nextContribution) })}
                </p>
                {result.contributionBreakEvenVisits !== null && (
                  <p className="text-muted-foreground mt-2 text-sm">
                    {t("contributionBreakEven", {
                      visits: fmt.full(result.contributionBreakEvenVisits),
                    })}
                  </p>
                )}
                {result.hourlyContribution !== null && (
                  <p className="mt-2 text-sm">
                    {t("hourly", { amount: won(result.hourlyContribution) })}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <p className="text-muted-foreground text-xs leading-5">{t("note")}</p>
    </section>
  )
}
