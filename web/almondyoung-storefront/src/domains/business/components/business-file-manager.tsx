"use client"

import { Button } from "@components/common/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@components/common/ui/collapsible"
import { Label } from "@components/common/ui/label"
import { ChevronsDown, Upload, X } from "lucide-react"
import React from "react"
import { useFormContext } from "react-hook-form"
import { BusinessDtoSchema } from "./schema"
import { getDisplayFilename } from "@lib/utils/get-diplay-filename"

export default function BusinessFileManager({
  isFilled,
}: {
  isFilled: boolean
}) {
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
            사업자가 없으신가요?
          </h4>

          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="hover:bg-gray-10 hover:text-gray-90 size-8"
            >
              <ChevronsDown />
              <span className="sr-only">Toggle</span>
            </Button>
          </CollapsibleTrigger>
        </div>

        <CollapsibleContent className="">
          <Label className="text-xs leading-none font-medium">
            사업자가 없으시다면 파일로 대신 제출하셔도 돼요
          </Label>

          <div className="mt-4 space-y-2">
            <BusinessFileForm />

            <p className="text-muted-foreground text-xs">
              PDF, JPG, PNG 파일만 업로드 가능합니다. (최대 10MB)
            </p>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div></div>
    </div>
  )
}

function BusinessFileForm() {
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
        파일 선택
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
  // 새로 업로드한 파일이 있으면 그것만 표시
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

  // 아무것도 없으면 null 반환
  return null
}
