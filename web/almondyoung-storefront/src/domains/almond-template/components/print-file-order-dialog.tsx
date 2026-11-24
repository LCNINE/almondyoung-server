"use client"

import { Check, FileUp, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { useId, useState, useTransition } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet"
import { useMediaQuery } from "@/hooks/use-media-query"
import {
  confirmCustomerPrintFile,
  presignCustomerPrintFile,
} from "@/lib/api/print/customer-print-file"
import { cn } from "@/lib/utils"
import {
  fileProblem,
  formatsLabel,
  type PrintFileSpec,
} from "../lib/customer-print-file"

export interface AttachedPrintFile {
  id: string
  name: string
}

interface PrintFileOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  extensions: readonly string[]
  // 상세페이지는 고른 크기의 작업·재단 크기를 보여 준다. 주문 상세에서 다시 올릴 땐 크기를 모를 수 있다
  spec?: PrintFileSpec
  title?: string
  subtitle?: string
  submitLabel?: string
  // 올린 파일을 넘긴다. 문구를 돌려주면 창에 띄우고 닫지 않는다
  onUploaded: (
    file: AttachedPrintFile
  ) => Promise<string | void> | string | void
}

const CONSENT_ITEMS = ["consent1", "consent2", "consent3", "consent4"] as const

export function PrintFileOrderDialog(props: PrintFileOrderDialogProps) {
  const t = useTranslations("productDetail.printFile")
  const wide = useMediaQuery("(min-width: 1280px)")
  const [busy, setBusy] = useState(false)
  const title = props.title ?? t("title")
  const subtitle = props.subtitle ?? t("subtitle")
  // 올리는 동안 닫으면 끝난 업로드가 이미 바뀐 화면에 붙는다. 끝날 때까지 닫지 못하게 한다
  const onOpenChange = (open: boolean) => {
    if (!busy) {
      props.onOpenChange(open)
    }
  }
  const form = (
    <PrintFileOrderForm
      {...props}
      onBusyChange={setBusy}
      close={() => props.onOpenChange(false)}
    />
  )

  if (wide) {
    return (
      <Dialog open={props.open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl gap-0 p-7">
          <DialogTitle className="text-xl font-bold">{title}</DialogTitle>
          <DialogDescription className="text-muted-foreground mt-1 text-sm">
            {subtitle}
          </DialogDescription>
          {form}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Sheet open={props.open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[92vh] overflow-y-auto rounded-t-3xl px-5 pt-6 pb-6 md:px-8"
      >
        <SheetTitle className="text-lg font-bold">{title}</SheetTitle>
        <SheetDescription className="text-muted-foreground mt-1 text-sm">
          {subtitle}
        </SheetDescription>
        {form}
      </SheetContent>
    </Sheet>
  )
}

function PrintFileOrderForm({
  extensions,
  spec,
  submitLabel,
  onUploaded,
  onBusyChange,
  close,
}: PrintFileOrderDialogProps & {
  onBusyChange: (busy: boolean) => void
  close: () => void
}) {
  const t = useTranslations("productDetail.printFile")
  const inputId = useId()
  const [file, setFile] = useState<File | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [isPending, startTransition] = useTransition()
  const formats = formatsLabel(extensions)

  const pick = (picked: File | undefined) => {
    if (!picked) {
      return
    }

    const issue = fileProblem(extensions, picked)
    setFile(issue ? null : picked)
    setProblem(
      issue === "type"
        ? t("wrongType", { formats })
        : issue === "size"
          ? t("tooLarge")
          : null
    )
  }

  const submit = () => {
    if (!file || !agreed) {
      return
    }

    onBusyChange(true)
    startTransition(async () => {
      try {
        const presigned = await presignCustomerPrintFile({
          fileName: file.name,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
        })
        // 서버 문구는 번역되지 않은 검증 메시지라 그대로 보여 주지 않는다
        if ("error" in presigned) {
          setProblem(t("uploadFail"))
          return
        }

        // 스토리지 서명 URL 로 직접 올린다(백엔드 API 가 아니라 api() 를 거치지 않는다)
        const put = await fetch(presigned.uploadUrl, {
          method: "PUT",
          headers: presigned.headers,
          body: file,
        })
        if (!put.ok) {
          throw new Error(`upload failed (${put.status})`)
        }

        const confirmed = await confirmCustomerPrintFile(presigned.fileId)
        if (
          confirmed &&
          typeof confirmed === "object" &&
          "error" in confirmed
        ) {
          setProblem(t("uploadFail"))
          return
        }

        const rejected = await onUploaded({
          id: presigned.fileId,
          name: file.name,
        })
        if (rejected) {
          setProblem(rejected)
          return
        }

        onBusyChange(false)
        close()
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }

        toast.error(t("uploadFail"))
      } finally {
        onBusyChange(false)
      }
    })
  }

  const hint = !file ? t("needFile") : !agreed ? t("needAgree") : null

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2 md:items-stretch">
        <div className="flex min-w-0 flex-col gap-3">
          <label
            htmlFor={inputId}
            className="border-border hover:bg-muted focus-within:ring-ring flex flex-1 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-[1.5px] border-dashed px-4 py-6 text-center focus-within:ring-2"
          >
            <FileUp className="text-muted-foreground mb-1 size-6" />
            <span className="text-foreground text-[15px] font-bold break-all">
              {file?.name ?? t("pick")}
            </span>
            <span
              role={problem ? "alert" : undefined}
              className={cn(
                "text-xs",
                problem ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {problem ??
                (file
                  ? t("pickChange", { size: (file.size / 1048576).toFixed(1) })
                  : t("pickHint", { formats }))}
            </span>
            <input
              id={inputId}
              type="file"
              className="sr-only"
              disabled={isPending}
              accept={extensions.map((extension) => `.${extension}`).join(",")}
              onChange={(event) => pick(event.target.files?.[0])}
            />
          </label>

          <dl className="bg-muted grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl px-4 py-3 text-[13px]">
            {spec && (
              <>
                <dt className="text-muted-foreground">{t("specWork")}</dt>
                <dd className="text-foreground font-bold tabular-nums">
                  {spec.work.width} × {spec.work.height}mm
                </dd>
                <dt className="text-muted-foreground">{t("specCut")}</dt>
                <dd className="text-foreground font-bold tabular-nums">
                  {spec.cut.width} × {spec.cut.height}mm
                </dd>
                <dt className="text-muted-foreground">{t("specSafety")}</dt>
                <dd className="text-foreground font-bold">
                  {t("specSafetyValue", { mm: spec.safetyMm })}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">{t("specFile")}</dt>
            <dd className="text-foreground font-bold">{t("specFileValue")}</dd>
            {(!spec || spec.duplex) && (
              <>
                <dt className="text-muted-foreground">{t("specSides")}</dt>
                <dd className="text-foreground font-bold">
                  {t("specSidesValue")}
                </dd>
              </>
            )}
          </dl>
        </div>

        <div
          className={cn(
            "flex min-w-0 flex-col overflow-hidden rounded-2xl border transition-colors",
            agreed ? "border-foreground" : "border-border"
          )}
        >
          <div className="flex-1 px-5 py-4">
            <p className="text-foreground text-[15px] font-bold">
              {t("consentTitle")}
            </p>
            <ul className="text-muted-foreground mt-2 flex list-disc flex-col gap-1 pl-4 text-[13px] leading-5">
              {CONSENT_ITEMS.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ul>
          </div>
          <label
            className={cn(
              "border-border text-foreground flex cursor-pointer items-start gap-2.5 border-t px-5 py-4 text-sm leading-5 font-bold",
              agreed && "bg-muted"
            )}
          >
            <input
              type="checkbox"
              className="peer sr-only"
              checked={agreed}
              disabled={isPending}
              onChange={(event) => setAgreed(event.target.checked)}
            />
            <span
              className={cn(
                "peer-focus-visible:ring-ring flex size-6 shrink-0 items-center justify-center rounded-full peer-focus-visible:ring-2",
                agreed
                  ? "bg-foreground text-white"
                  : "border-border border-2 text-transparent"
              )}
            >
              <Check className="size-3.5" strokeWidth={3} />
            </span>
            <span className="pt-0.5">{t("consentAgree")}</span>
          </label>
        </div>
      </div>

      <Button
        className="h-12 w-full text-base"
        disabled={!file || !agreed || isPending}
        onClick={submit}
      >
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {t("uploading")}
          </>
        ) : (
          (submitLabel ?? t("submit"))
        )}
      </Button>
      {hint && (
        <p className="text-muted-foreground -mt-2 text-center text-xs">
          {hint}
        </p>
      )}
    </div>
  )
}
