"use client"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import {
  localeToCountryCode,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "@/lib/utils/locale-path"
import { ChevronDown, Globe } from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

type Variant = "header" | "sheet"

interface LanguageSwitcherProps {
  variant?: Variant
  className?: string
}

export function LanguageSwitcher({
  variant = "header",
  className,
}: LanguageSwitcherProps) {
  const locale = useLocale() as SupportedLocale
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const t = useTranslations("languageSwitcher")

  const handleSelect = (next: SupportedLocale) => {
    if (next === locale) return

    const segments = pathname.split("/")
    const nextCountry = localeToCountryCode(next)

    if (segments.length > 1 && /^[a-z]{2}$/i.test(segments[1] ?? "")) {
      segments[1] = nextCountry
    } else {
      segments.splice(1, 0, nextCountry)
    }

    const nextPath = segments.join("/") || `/${nextCountry}`
    const query = searchParams.toString()
    const href = query ? `${nextPath}?${query}` : nextPath

    router.push(href)
    router.refresh()
  }

  const triggerClassName =
    variant === "header"
      ? "flex cursor-pointer items-center gap-1 text-xs text-white/80 transition-colors hover:text-white outline-none"
      : "flex cursor-pointer items-center gap-1 text-sm text-foreground transition-colors hover:text-primary outline-none"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("label")}
        className={cn(triggerClassName, className)}
      >
        <Globe className="h-3.5 w-3.5" />
        <span>{locale.toUpperCase()}</span>
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[8rem]">
        {SUPPORTED_LOCALES.map((l) => (
          <DropdownMenuItem
            key={l}
            onSelect={() => handleSelect(l)}
            data-active={l === locale}
            className={cn(
              "cursor-pointer",
              l === locale && "font-semibold text-primary"
            )}
          >
            {t(l)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
