"use client"

import React from "react"
import Link from "next/link"
import { usePathname, useParams } from "next/navigation"
import { IconText } from "."

// Context for sharing variant and size
const IconTextContext = React.createContext<{
  variant?: Variant
  size?: Size
}>({})

type Variant = "default" | "active"
type Size = "sm" | "md" | "lg"

// 현재 경로에서 연속된 countryCode 프리픽스(예: /kr/kr/...)를 모두 제거하고
// 현재/params에서 cc를 추론한 뒤, 절대경로로만 href를 만들어줌.
function useLocaleHref() {
  const pathname = (usePathname() ?? "/").split("?")[0]
  const params = useParams() as { countryCode?: string }

  const isCC = (s?: string) => !!s && /^[a-z]{2}$/i.test(s)
  const segs = pathname.split("/").filter(Boolean)

  // 앞쪽 연속 cc 제거
  let i = 0
  while (i < segs.length && isCC(segs[i])) i++
  const rest = segs.slice(i)

  // cc 추론: params 우선 → path 첫 세그먼트
  const ccFromPath = isCC(segs[0]) ? segs[0] : undefined
  const cc = (isCC(params?.countryCode) ? params!.countryCode! : ccFromPath) || undefined

  // 'mypage', './mypage', '/mypage' → 'mypage' 로 정규화
  const clean = (s = "") => s.replace(/^(\.\/|\/)/, "")

  // 절대경로 생성기: cc가 있으면 /cc/seg, 없으면 /seg
  const href = (seg = "") => {
    const c = clean(seg)
    if (cc) return c ? `/${cc}/${c}` : `/${cc}`
    return c ? `/${c}` : "/"
  }

  return { href, currentRoot: (rest[0] ?? "").toLowerCase(), cc }
}

export function IconTextLink({
  to,               // 'search' | '/search' | './search' | ''(=홈)
  children,
  className,
  size = "md",
  variant = "default",
}: {
  to: string
  children: React.ReactNode
  className?: string
  size?: Size
  variant?: Variant
}) {
  const { href } = useLocaleHref()
  const target = href(to) // 항상 절대경로로 보정됨

  return (
    <Link
      href={target}
      className={[
        "flex flex-col items-center justify-center gap-1 transition-colors",
        "hover:opacity-80 focus:outline-none",
        size === "sm" && "p-1",
        size === "md" && "p-1",
        size === "lg" && "p-1",
        className,
      ].filter(Boolean).join(" ")}
    >
      <IconTextContext.Provider value={{ variant, size }}>
        {children}
      </IconTextContext.Provider>
    </Link>
  )
}

export function IconTextIcon({
  children,
  className,
  variant,
  size,
}: {
  children: React.ReactNode
  className?: string
  variant?: "default" | "active"
  size?: "sm" | "md" | "lg"
}) {
  const context = React.useContext(IconTextContext)
  const finalVariant = variant || context.variant || "default"
  const finalSize = size || context.size || "md"
  
  return (
    <div
      className={[
        "flex items-center justify-center transition-colors",
        finalSize === "sm" && "h-4 w-4",
        finalSize === "md" && "h-6 w-6",
        finalSize === "lg" && "h-8 w-8",
        finalVariant === "default" && "text-gray-600",
        finalVariant === "active" && "text-yellow-30",
        className,
      ].filter(Boolean).join(" ")}
    >
      {children}
    </div>
  )
}

export function IconTextText({
  children,
  className,
  variant,
  size,
}: {
  children: React.ReactNode
  className?: string
  variant?: "default" | "active"
  size?: "sm" | "md" | "lg"
}) {
  const context = React.useContext(IconTextContext)
  const finalVariant = variant || context.variant || "default"
  const finalSize = size || context.size || "md"
  
  return (
    <span
      className={[
        "font-medium transition-colors",
        finalSize === "sm" && "text-xs",
        finalSize === "md" && "text-sm",
        finalSize === "lg" && "text-base",
        finalVariant === "default" && "text-gray-600",
        finalVariant === "active" && "text-yellow-30",
        className,
      ].filter(Boolean).join(" ")}
    >
      {children}
    </span>
  )
}

// IconTextRoot export 추가
export const IconTextRoot = IconText