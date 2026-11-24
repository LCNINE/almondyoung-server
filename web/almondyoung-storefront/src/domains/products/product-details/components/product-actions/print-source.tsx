"use client"

import Image from "next/image"
import { FileText } from "lucide-react"
import { useTranslations } from "next-intl"
import LocalizedClientLink from "@/components/shared/localized-client-link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AttachedPrintFile } from "@/domains/almond-template/components/print-file-order-dialog"

// 인쇄 상품에서 무엇으로 인쇄할지 고르는 두 갈래: 아몬드템플릿으로 디자인 / 내 파일로 주문
export function PrintSourceButtons({
  templateHref,
  onFileOrder,
  className,
}: {
  templateHref?: string
  onFileOrder?: () => void
  className?: string
}) {
  const t = useTranslations("productDetail.printFile")

  if (!templateHref && !onFileOrder) {
    return null
  }

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      {templateHref && (
        <LocalizedClientLink href={templateHref} className="w-full">
          <Button variant="outline" className="h-12 w-full">
            <Image
              src="/images/almond-template-palette.png"
              alt=""
              width={20}
              height={20}
            />
            {t("templateButton")}
          </Button>
        </LocalizedClientLink>
      )}
      {onFileOrder && (
        <Button variant="outline" className="h-12 w-full" onClick={onFileOrder}>
          <FileText className="size-5" />
          {t("fileButton")}
        </Button>
      )}
    </div>
  )
}

export function PrintFileNotice({
  file,
  onChange,
}: {
  file: AttachedPrintFile
  onChange: () => void
}) {
  const t = useTranslations("productDetail.printFile")
  const extension = file.name.split(".").pop()?.toUpperCase() ?? ""

  return (
    <div className="border-border bg-muted flex items-center gap-3 rounded-lg border px-3 py-2">
      <span className="border-border text-foreground flex h-10 w-9 shrink-0 items-center justify-center rounded border bg-white text-[10px] font-bold">
        {extension}
      </span>
      <div className="min-w-0 flex-1 text-xs">
        <p className="text-foreground truncate">
          <span className="font-semibold">{t("attachedTitle")}</span>
          <span className="text-muted-foreground"> · </span>
          {file.name}
        </p>
        <p className="text-muted-foreground mt-0.5">{t("attachedHint")}</p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 underline"
        onClick={onChange}
      >
        {t("change")}
      </Button>
    </div>
  )
}
