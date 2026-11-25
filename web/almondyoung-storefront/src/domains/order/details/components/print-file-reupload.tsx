"use client"

import { FileText } from "lucide-react"
import { useTranslations } from "next-intl"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  PRINT_LINE_PARAM,
  printFileReasonKey,
} from "@/lib/utils/print-file-rejection"
import { PrintFileOrderDialog } from "@/domains/almond-template/components/print-file-order-dialog"
import { reuploadPrintFile } from "@/lib/api/print/print-file-rejections"
import type { PrintFileRejection } from "@/lib/types/ui/print-orders"

const REJECTION_COPY: Record<
  string,
  "notYours" | "wrongType" | "sameFile" | "alreadySent" | "failed"
> = {
  PRINT_FILE_NOT_YOURS: "notYours",
  PRINT_FILE_TYPE_NOT_ACCEPTED: "wrongType",
  PRINT_FILE_SAME_AS_REJECTED: "sameFile",
  PRINT_FILE_NOT_REJECTED: "alreadySent",
  PRINT_FILE_DELIVERY_FAILED: "failed",
}

// 와우프레스가 파일 문제로 돌려보낸 인쇄 줄. 그 줄 안에서 새 파일을 올려 같은 주문으로 인쇄를 잇는다
export function PrintFileReupload({
  rejection,
}: {
  rejection: PrintFileRejection
}) {
  const t = useTranslations("mypage.order.printFileReupload")
  const tBell = useTranslations("header.printFileBell")
  const router = useRouter()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const targeted =
    !!rejection.channelOrderItemId &&
    searchParams.get(PRINT_LINE_PARAM) === rejection.channelOrderItemId

  // 알림에서 왔으면 이 줄로 내려간다. PC·모바일 화면이 함께 그려지므로 보이는 쪽만 움직인다
  useEffect(() => {
    if (targeted && ref.current?.offsetParent) {
      ref.current.scrollIntoView({ block: "center" })
    }
  }, [targeted])

  const send = async (fileId: string): Promise<string | void> => {
    const result = await reuploadPrintFile(rejection.salesOrderLineId, fileId)
    if ("error" in result) {
      const copy = REJECTION_COPY[result.error]

      return copy ? t(copy) : t("failed")
    }

    toast.success(t("done"))
    router.refresh()
  }

  return (
    <div
      ref={ref}
      className="border-destructive bg-destructive/5 mt-2 flex flex-col gap-2 rounded-xl border p-3"
    >
      <p className="text-destructive text-[13px] font-bold">{t("stopped")}</p>
      <p className="text-foreground text-[13px]">
        {t("reason", {
          reason: tBell(`reasons.${printFileReasonKey(rejection.jobstat)}`),
        })}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="h-10 w-full bg-white"
        onClick={() => setOpen(true)}
      >
        <FileText className="size-4" />
        {t("button")}
      </Button>
      <PrintFileOrderDialog
        open={open}
        onOpenChange={setOpen}
        extensions={rejection.acceptedExtensions}
        title={t("dialogTitle")}
        subtitle={t("dialogSubtitle")}
        submitLabel={t("submit")}
        onUploaded={(file) => send(file.id)}
      />
    </div>
  )
}
