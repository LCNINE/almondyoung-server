"use client"

import { Button } from "@/components/ui/button"
import { getDisplayFilename } from "@lib/utils/get-diplay-filename"
import { Upload, X } from "lucide-react"
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
      form.setValue("isSubmitting", true)

      e.target.value = ""
    }
  }

  const handleRemoveFile = (e: React.MouseEvent) => {
    e.stopPropagation()
    form.setValue("file", undefined, { shouldValidate: true })
    form.setValue("fileUrl", undefined)
    form.setValue("isSubmitting", Boolean(form.getValues("nts")))
    if (inputRef.current) inputRef.current.value = ""
  }

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor="businessFileInput"
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center transition-colors hover:bg-muted"
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <span className="text-sm font-medium">{t("uploadPrompt")}</span>
        <span className="text-xs text-muted-foreground">{t("uploadHint")}</span>
        <input
          id="businessFileInput"
          ref={inputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleFileChange}
        />
      </label>

      <FilePreview
        file={file ?? null}
        fileUrl={fileUrl ?? null}
        onRemove={handleRemoveFile}
      />
    </div>
  )
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

  if (!previewUrl) return null

  return (
    <Dialog>
      <DialogTrigger asChild>
        <div className="group relative h-40 w-40 cursor-pointer overflow-hidden rounded-sm border">
          <Image
            src={previewUrl}
            alt={t("fileAlt")}
            fill
            sizes="160px"
            unoptimized={isLocalFile}
            className="object-contain transition-transform duration-200 group-hover:scale-110"
          />

          <Button
            type="button"
            size="icon"
            className="absolute top-1 right-1 h-6 w-6 cursor-pointer"
            onClick={onRemove}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
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
