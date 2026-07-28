"use client"

import { Button } from "@/components/ui/button"
import { getDisplayFilename } from "@lib/utils/get-diplay-filename"
import { FileText, Upload, X } from "lucide-react"
import { useTranslations } from "next-intl"
import React from "react"
import { useFormContext } from "react-hook-form"
import { BusinessDtoSchema } from "./schema"
import Image from "next/image"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export default function BusinessFileUploader() {
  return (
    <BusinessFileForm />
  )
}

function BusinessFileForm() {
  const t = useTranslations("business.fileManager")
  const form = useFormContext<BusinessDtoSchema>()
  const fileUrl = form.watch("fileUrl") // 기존 S3 URL
  const file = form.watch("file") // 새로 업로드할 파일

  const inputRef = React.useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFile = e.target.files?.[0]

    if (newFile) {
      form.setValue("file", newFile, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      })

      e.target.value = ""
    }
  }

  const handleRemoveFile = (e: React.MouseEvent) => {
    e.stopPropagation()
    form.setValue("file", undefined, { shouldValidate: true })
    form.setValue("fileUrl", undefined)
    if (inputRef.current) inputRef.current.value = ""
  }

  const attached = Boolean(file || fileUrl)

  return (
    <div>
      <input
        id="businessFileInput"
        ref={inputRef}
        type="file"
        className="sr-only"
        accept=".pdf,.jpg,.jpeg,.png"
        onChange={handleFileChange}
      />

      {attached ? (
        <FilePreview
          file={file ?? null}
          fileUrl={fileUrl ?? null}
          onRemove={handleRemoveFile}
        />
      ) : (
        <label
          htmlFor="businessFileInput"
          className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-6 text-center transition-colors hover:bg-muted"
        >
          <Upload className="text-muted-foreground size-5" />
          <span className="text-sm font-medium">{t("uploadPrompt")}</span>
          <span className="text-muted-foreground text-xs">
            {t("uploadHint")}
          </span>
        </label>
      )}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function FilePreview({
  file,
  fileUrl,
  onRemove,
}: {
  file: File | null // 새로 업로드할 파일
  fileUrl: string | null // 기존 S3 URL
  onRemove: (e: React.MouseEvent) => void
}) {
  const t = useTranslations("business.fileManager")
  // 새로 선택한 File 은 blob URL 로 미리보기, 기존 파일은 S3 URL 사용
  const [filePreview, setFilePreview] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!file) {
      setFilePreview(null)
      return
    }
    const objectUrl = URL.createObjectURL(file)
    setFilePreview(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file])

  const previewUrl = filePreview ?? fileUrl
  const isLocalFile = Boolean(file) // blob URL 은 next/image 최적화 불가 → unoptimized
  const filename = file ? file.name : fileUrl ? getDisplayFilename(fileUrl) : ""
  const isPdf = /\.pdf$/i.test(filename)

  if (!previewUrl) return null

  const card = (
    <div className="flex items-center gap-3 rounded-xl border p-3">
      {isPdf ? (
        <div className="bg-muted flex size-11 shrink-0 items-center justify-center rounded-lg">
          <FileText className="text-muted-foreground size-5" />
        </div>
      ) : (
        <div className="bg-muted relative size-11 shrink-0 overflow-hidden rounded-lg">
          <Image
            src={previewUrl}
            alt={t("fileAlt")}
            fill
            sizes="44px"
            unoptimized={isLocalFile}
            className="object-cover"
          />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-sm font-medium">{filename}</span>
        <span className="text-muted-foreground text-xs">
          {[file ? formatFileSize(file.size) : null, isPdf ? null : t("tapToZoom")]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        onClick={onRemove}
        aria-label={t("removeFile")}
      >
        <X className="size-4" />
      </Button>
    </div>
  )

  // PDF 는 next/image 로 못 그리므로 확대 다이얼로그 없이 카드만 보여준다.
  if (isPdf) return card

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="w-full cursor-pointer">
          {card}
        </button>
      </DialogTrigger>
      <DialogContent
        className="w-auto max-w-[90vw]"
        aria-describedby="business-file-preview-desc"
      >
        <DialogTitle className="sr-only">{t("fileDialogTitle")}</DialogTitle>
        <DialogDescription className="sr-only">
          {t("fileDialogDescription")}
        </DialogDescription>

        <div className="flex flex-col items-center p-2">
          <Image
            src={previewUrl}
            alt={t("fileAlt")}
            width={600}
            height={600}
            unoptimized={isLocalFile}
            className="h-auto max-w-full rounded border"
            style={{ objectFit: "contain" }}
          />
          <span
            id="business-file-preview-desc"
            className="text-muted-foreground mt-2 text-xs"
          >
            {filename}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
