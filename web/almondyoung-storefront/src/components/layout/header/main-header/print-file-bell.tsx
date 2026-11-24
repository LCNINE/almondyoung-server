"use client"

import { Bell } from "lucide-react"
import { useTranslations } from "next-intl"
import { usePathname } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useUser } from "@/contexts/user-context"
import { listPrintFileRejections } from "@/lib/api/print/print-file-rejections"
import { cn } from "@/lib/utils"
import { DATE_FORMATS, formatDate } from "@/lib/utils/format-date"
import {
  printFileReasonKey,
  printFileRejectionHref,
} from "@/lib/utils/print-file-rejection"
import type { PrintFileRejection } from "@/lib/types/ui/print-orders"

const isUnauthorized = (error: unknown) => {
  const err = error as Error & { digest?: string }

  return err?.digest === "UNAUTHORIZED" || err?.message === "UNAUTHORIZED"
}

// 와우프레스가 고객 파일을 돌려보낸 인쇄 줄을 알린다. 벨은 부가 기능이라 조회가 실패해도 헤더를 깨지 않는다.
// 다만 로그인이 풀린 것이면 다른 화면처럼 토큰 복구로 넘긴다
export function PrintFileBell({ tone = "light" }: { tone?: "light" | "dark" }) {
  const t = useTranslations("header.printFileBell")
  const { user } = useUser()
  const pathname = usePathname()
  const [rejections, setRejections] = useState<PrintFileRejection[]>([])
  const [open, setOpen] = useState(false)
  const [, startTransition] = useTransition()

  useEffect(() => {
    if (!user) {
      setRejections([])
      return
    }

    let alive = true
    listPrintFileRejections()
      .then((rows) => {
        if (alive) {
          setRejections(rows)
        }
      })
      .catch((error: unknown) => {
        if (alive && isUnauthorized(error)) {
          startTransition(() => {
            throw error
          })
        }
      })

    return () => {
      alive = false
    }
  }, [user, pathname])

  if (!user) {
    return null
  }

  const label =
    rejections.length > 0
      ? t("labelWithCount", { count: rejections.length })
      : t("label")

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-1",
            tone === "dark" ? "text-gray-700" : "text-white"
          )}
        >
          <span className="relative">
            <Bell className="h-6 w-6 md:h-8 md:w-8" />
            {rejections.length > 0 && (
              <span className="bg-destructive absolute -top-1 -right-1 h-2 w-2 rounded-full md:h-2.5 md:w-2.5" />
            )}
          </span>
          <span className="hidden text-[clamp(0.625rem,1.2vw,0.75rem)] leading-none font-medium whitespace-nowrap md:block">
            {t("label")}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
      >
        <p className="border-border border-b px-4 py-3 text-sm font-bold">
          {t("title")}
        </p>
        {rejections.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-center text-sm">
            {t("empty")}
          </p>
        ) : (
          <ul className="divide-border max-h-96 divide-y overflow-y-auto">
            {rejections.map((rejection) => (
              <li key={rejection.salesOrderLineId}>
                <LocalizedClientLink
                  href={printFileRejectionHref(rejection)}
                  onClick={() => setOpen(false)}
                  className="bg-muted hover:bg-secondary flex gap-2.5 px-4 py-3"
                >
                  <span className="bg-destructive mt-1.5 size-2 shrink-0 rounded-full" />
                  <span className="min-w-0 text-sm">
                    <span className="text-foreground block font-bold">
                      {t("itemTitle", { product: rejection.productName })}
                    </span>
                    <span className="text-foreground mt-0.5 block text-[13px]">
                      {t("itemBody", {
                        reason: t(
                          `reasons.${printFileReasonKey(rejection.jobstat)}`
                        ),
                      })}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      {formatDate(
                        rejection.rejectedAt,
                        DATE_FORMATS.KO_DOT_TIME
                      )}{" "}
                      · {t("itemAction")}
                    </span>
                  </span>
                </LocalizedClientLink>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
