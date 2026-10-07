"use client"

import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

const LEADING_SYMBOLS = new RegExp(
  "^[^0-9A-Za-z\\uAC00-\\uD7A3\\u3040-\\u30FF\\u4E00-\\u9FFF\\[(]+"
)

export function stripLeadingSymbols(text: string) {
  return text.replace(LEADING_SYMBOLS, "")
}

export function Card({
  children,
  note,
  className,
}: {
  children: React.ReactNode
  note?: string
  className?: string
}) {
  return (
    <section className={cn("bg-background rounded-2xl p-6", className)}>
      {children}
      {note && (
        <p className="text-muted-foreground mt-6 text-[13px] leading-[19.5px]">
          {note}
        </p>
      )}
    </section>
  )
}

export function Headline({
  eyebrow,
  children,
}: {
  eyebrow?: string
  children: React.ReactNode
}) {
  return (
    <header>
      {eyebrow && (
        <p className="text-muted-foreground text-[13px] leading-[19.5px] font-medium">
          {eyebrow}
        </p>
      )}
      <h2 className="text-foreground mt-1 text-xl leading-[29px] font-bold break-keep">
        {children}
      </h2>
    </header>
  )
}

export function Big({ children }: { children: React.ReactNode }) {
  return (
    <strong className="text-[26px] leading-[35px] tabular-nums">
      {children}
    </strong>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn("bg-secondary flex rounded-xl p-1", className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-10 flex-1 rounded-lg text-[15px] font-medium transition-colors duration-150",
            value === option.value
              ? "bg-background text-foreground font-bold shadow-[0_1px_4px_rgba(0,0,0,.08)]"
              : "text-muted-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Chip({
  active,
  onClick,
  onCanvas = false,
  children,
}: {
  active: boolean
  onClick: () => void
  onCanvas?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-8 shrink-0 rounded-full px-3 text-[13px] font-medium transition-colors duration-150",
        active
          ? "bg-foreground text-white"
          : onCanvas
            ? "bg-background text-foreground"
            : "bg-secondary text-foreground"
      )}
    >
      {children}
    </button>
  )
}

export function Bars({
  values,
  firstLabel,
  lastLabel,
  lastAnnotation,
}: {
  values: number[]
  firstLabel: string
  lastLabel: string
  lastAnnotation?: string
}) {
  const max = Math.max(1, ...values)
  return (
    <figure className="mt-6">
      <div className="flex h-52 items-end gap-1 pt-6">
        {values.map((value, index) => {
          const last = index === values.length - 1
          return (
            <div
              key={index}
              className="relative flex h-full flex-1 flex-col justify-end"
            >
              {last && lastAnnotation && (
                <span className="text-foreground absolute -top-6 left-1/2 -translate-x-1/2 text-[13px] font-bold whitespace-nowrap tabular-nums">
                  {lastAnnotation}
                </span>
              )}
              <div
                className={cn(
                  "w-full rounded-t",
                  last ? "bg-primary" : "bg-border"
                )}
                style={{ height: `${Math.max(4, (value / max) * 100)}%` }}
              />
            </div>
          )
        })}
      </div>
      <figcaption className="text-muted-foreground mt-2 flex justify-between text-[13px]">
        <span>{firstLabel}</span>
        <span>{lastLabel}</span>
      </figcaption>
    </figure>
  )
}

export function LoadError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("beautytop")
  return (
    <div className="py-6 text-center">
      <p className="text-muted-foreground text-[15px]">{t("error")}</p>
      <button
        type="button"
        onClick={onRetry}
        className="bg-secondary text-foreground mt-3 h-10 rounded-lg px-4 text-[15px] font-medium"
      >
        {t("retry")}
      </button>
    </div>
  )
}

export function CardSkeleton() {
  return (
    <div className="bg-background space-y-3 rounded-2xl p-6">
      <Skeleton className="h-4 w-1/4" />
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="mt-4 h-24 w-full" />
    </div>
  )
}

export function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted rounded-xl p-4">
      <p className="text-muted-foreground text-[13px]">{label}</p>
      <p className="text-foreground mt-1 text-xl leading-[29px] font-bold tabular-nums">
        {value}
      </p>
    </div>
  )
}
