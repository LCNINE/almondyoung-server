"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

interface HeaderProps {
  children: React.ReactNode
  className?: string
}

export function Header({ children, className }: HeaderProps) {
  return (
    <div
      className={cn("relative flex items-end justify-between gap-4", className)}
    >
      {children}
    </div>
  )
}

export function Title({
  children,
  className,
  id,
}: {
  children: React.ReactNode
  className?: string
  id?: string
}) {
  return (
    <h2
      id={id}
      className={cn(
        "text-ink flex items-center gap-2 text-[20px] leading-[1.3] font-bold tracking-[-0.03em] md:text-[24px]",
        className
      )}
    >
      {children}
    </h2>
  )
}

export function Subtitle({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <p className={cn("text-muted-foreground mt-1 text-sm", className)}>
      {children}
    </p>
  )
}

// 더보기 버튼
export function MoreButton({
  showOnDesktop = false,
  className,
  href,
  variant = "more",
  label,
}: {
  showOnDesktop?: boolean
  className?: string
  href: string
  label?: string
  /** more: 13px 회색 밑줄 "더보기" / viewAll: 14px 굵게 밑줄 없는 "전체 보기" */
  variant?: "more" | "viewAll"
}) {
  const t = useTranslations("home.sectionHead")

  return (
    <LocalizedClientLink
      href={href}
      className={cn(
        "hover:text-ink whitespace-nowrap",
        variant === "more"
          ? "text-muted-foreground text-[13px] underline underline-offset-4"
          : "text-ink/80 text-sm font-semibold",
        !showOnDesktop && "md:hidden",
        className
      )}
    >
      {label ?? t(variant)}
    </LocalizedClientLink>
  )
}

/** 홈 섹션 머리: 왼쪽 제목(+설명), 오른쪽 더보기 */
export function SectionHead({
  title,
  subtitle,
  moreHref,
  moreVariant = "more",
  moreLabel,
  extra,
  id,
  className,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  moreHref?: string
  moreVariant?: "more" | "viewAll"
  moreLabel?: string
  /** 더보기 옆에 붙는 요소 (편집 버튼 등) */
  extra?: React.ReactNode
  id?: string
  className?: string
}) {
  return (
    <Header className={cn("mb-6 flex-wrap md:mb-8 md:flex-nowrap", className)}>
      <div className="min-w-0">
        <Title id={id}>{title}</Title>
        {subtitle && <Subtitle>{subtitle}</Subtitle>}
      </div>

      {(moreHref || extra) && (
        <div className="flex items-center gap-2">
          {moreHref && (
            <MoreButton
              href={moreHref}
              variant={moreVariant}
              label={moreLabel}
              showOnDesktop
            />
          )}
          {extra}
        </div>
      )}
    </Header>
  )
}
