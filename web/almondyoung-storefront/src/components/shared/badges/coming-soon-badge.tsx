"use client"

import { cn } from "@lib/utils"
import { formatDate } from "@/lib/utils/format-date"
import { useTranslations } from "next-intl"

/**
 * 출시 예정 상품 표시
 */
export function ComingSoonBadge({
  date,
  label,
  size = "sm",
  className,
}: {
  /** 표시 전용 출시예정일 (YYYY-MM-DD). 없으면 날짜 없이 문구만. */
  date?: string | null
  /** 지정하면 date 대신 이 문구를 그린다. 예: "일부 출시 예정" */
  label?: string
  /** lg 는 상품 이미지 위처럼 멀리서도 읽혀야 하는 자리용. */
  size?: "sm" | "lg"
  className?: string
}) {
  const t = useTranslations("productCard")
  const isLarge = size === "lg"

  return (
    <span
      className={cn(
        "relative z-0 inline-flex w-fit shrink-0 overflow-hidden align-middle",
        isLarge ? "rounded-lg p-[2px] shadow-md" : "rounded p-px",
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-[-150%] bg-[conic-gradient(from_0deg,transparent_0deg,var(--primary)_60deg,#ffb877_110deg,transparent_170deg,transparent_360deg)] motion-reduce:animate-none",
          isLarge
            ? "animate-[spin-glow_2.2s_linear_infinite]"
            : "animate-[spin-glow_3s_linear_infinite]"
        )}
      />
      <span
        className={cn(
          "bg-background relative font-semibold text-black",
          isLarge
            ? "rounded-[6px] px-3 py-1.5 text-[14px] leading-[1.3] tracking-tight"
            : "rounded-[3px] px-1.5 py-px text-[11px] leading-[1.4]"
        )}
      >
        {label ??
          (date
            ? t("comingSoonBadgeDated", { date: formatDate(date, "M/d") })
            : t("comingSoonBadge"))}
      </span>
    </span>
  )
}
