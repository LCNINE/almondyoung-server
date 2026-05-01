"use client"

import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface HeaderProps {
  children: React.ReactNode
  className?: string
}

export function Header({ children, className }: HeaderProps) {
  return (
    <div
      className={cn("relative flex items-center justify-between", className)}
    >
      {children}
    </div>
  )
}

export function Title({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <h2 className={cn("text-[22px] font-bold md:text-[26px]", className)}>
      {children}
    </h2>
  )
}

// 더보기 버튼
export function MoreButton({
  showOnDesktop = false,
  className,
  href,
}: {
  showOnDesktop?: boolean
  className?: string
  href: string
}) {
  return (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className={cn(
        "text-gray-40 hover:text-gray-90 hover:bg-transparent",
        !showOnDesktop && "md:hidden", // showOnDesktop이 false면 데스크탑(md)에서 숨김.
        showOnDesktop && "md:absolute md:right-0",
        className
      )}
    >
      <LocalizedClientLink href={href} className="underline underline-offset-4">
        더보기
      </LocalizedClientLink>
    </Button>
  )
}
