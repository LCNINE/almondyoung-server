"use client"

import { Button } from "@components/common/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@components/common/ui/collapsible"
import { Label } from "@components/common/ui/label"
import { ChevronsDown, Upload, X } from "lucide-react"
import { useTranslations } from "next-intl"
import React from "react"
import { useFormContext } from "react-hook-form"
import { BusinessDtoSchema } from "./schema"
import { getDisplayFilename } from "@lib/utils/get-diplay-filename"

export default function BusinessFileManager({
  isFilled,
}: {
  isFilled: boolean
}) {
  const t = useTranslations("business.fileManager")
  const [isOpen, setIsOpen] = React.useState(isFilled || false)

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="flex w-full flex-col"
      >
        <div
          className="flex items-center justify-between"
          onClick={() => setIsOpen(!isOpen)}
        >
          <h4 className="cursor-pointer text-sm font-semibold">
            {t("noBusinessTitle")}
          </h4>

          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hover:bg-gray-10 hover:text-gray-90 size-8"
            >
              <ChevronsDown />
              <span className="sr-only">{t("toggleLabel")}</span>
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent className="">
          <Label className="text-xs leading-none font-medium">
            {t("fileAlternative")}
          </Label>

          <div className="mt-4 space-y-2">
            <BusinessFileForm />

            <p className="text-muted-foreground text-xs">
              {t("fileTypeHint")}
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div></div>
    </div>
  )
}

function BusinessFileForm() {
  const t = useTranslations("business.fileManager")
  const form = useFormContext<BusinessDtoSchema>()
  const fileUrl = form.watch("fileUrl") // 기존 S3 URL
  const file = form.watch("file") // 새로 업로드할 파일

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

  const handleRemoveFile = () => {
    form.setValue("file", undefined)
    form.setValue("fileUrl", undefined)
  }

  return (
    <div className="flex items-center gap-3">
      <label className="border-input bg-background hover:bg-muted flex shrink-0 cursor-pointer items-center gap-2 rounded-md border-2 px-4 py-2 text-sm transition-colors">
        <Upload className="h-4 w-4" />
        {t("fileSelectButton")}
        <input
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
  file: File | null
  fileUrl: string | null
  onRemove: () => void
}) {
  if (file) {
    return (
      <div className="bg-muted flex items-center gap-2 rounded-md px-3 py-2 text-sm">
        <span className="max-w-[200px] truncate">
          {file.name.length > 20 ? file.name.slice(0, 20) + "..." : file.name}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive relative z-50 cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  if (fileUrl && !file) {
    return (
      <div className="bg-muted flex items-center gap-2 rounded-md px-3 py-2 text-sm">
        <span className="max-w-[200px] truncate text-blue-600 underline">
          {getDisplayFilename(fileUrl, 20)}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return null
}
