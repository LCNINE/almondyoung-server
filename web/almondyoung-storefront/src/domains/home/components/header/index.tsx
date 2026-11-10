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
  accent,
}: {
  children: React.ReactNode
  className?: string
  id?: string
  /** 제목 끝의 이 낱말만 주황으로 칠한다 (라이브 섹션 제목 규칙) */
  accent?: string
}) {
  return (
    <h2
      id={id}
      className={cn(
        "flex items-center gap-2 text-[20px] leading-[1.3] font-bold text-black md:text-[26px] md:leading-[1.11]",
        className
      )}
    >
      <AccentText text={children} accent={accent} />
    </h2>
  )
}

function AccentText({
  text,
  accent,
}: {
  text: React.ReactNode
  accent?: string
}) {
  if (typeof text !== "string" || !accent || !text.endsWith(accent)) {
    return <>{text}</>
  }

  return (
    <span>
      {text.slice(0, text.length - accent.length)}
      <span className="text-mint">{accent}</span>
    </span>
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
  /** more: "더보기" / viewAll: "전체 보기". 모양은 같고 문구만 다르다 */
  variant?: "more" | "viewAll"
}) {
  const t = useTranslations("home.sectionHead")

  return (
    <LocalizedClientLink
      href={href}
      className={cn(
        "text-gray-40 hover:text-ink text-sm whitespace-nowrap underline underline-offset-[3px]",
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
  accent,
  centered = false,
}: {
  title: React.ReactNode
  accent?: string
  /** PC 에서 제목을 가운데에 두고 더보기만 오른쪽 끝에 붙인다 (라이브 카테고리 베스트) */
  centered?: boolean
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
    <Header
      className={cn(
        "mb-6 flex-wrap md:mb-8 md:flex-nowrap",
        centered && "md:justify-center",
        className
      )}
    >
      <div
        className={cn(
          "w-full min-w-0 md:w-auto",
          centered && "md:flex md:flex-col md:items-center md:text-center"
        )}
      >
        <Title
          id={id}
          accent={accent}
          className={cn(moreHref && "pr-16 md:pr-0")}
        >
          {title}
        </Title>
        {subtitle && <Subtitle className="break-keep">{subtitle}</Subtitle>}
      </div>

      {moreHref && (
        // 모바일은 더보기를 제목 줄 오른쪽 위에 붙여 설명문이 한 줄을 다 쓰게 한다
        <MoreButton
          href={moreHref}
          variant={moreVariant}
          label={moreLabel}
          showOnDesktop
          className={cn(
            "absolute top-1 right-0",
            centered ? "md:top-auto md:bottom-1" : "md:static"
          )}
        />
      )}
      {extra}
    </Header>
  )
}
