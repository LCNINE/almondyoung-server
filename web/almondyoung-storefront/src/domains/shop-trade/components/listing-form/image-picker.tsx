"use client"

import { ChevronLeft, ChevronRight, ImagePlus, X } from "lucide-react"
import Image from "next/image"
import { useTranslations } from "next-intl"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { MAX_SHOP_LISTING_IMAGES } from "@/domains/shop-trade/listing-form"
import { uploadFile } from "@/lib/api/file/upload"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { MAX_UPLOAD_BYTES, compressImageForUpload } from "@/lib/utils/image-compress"
import { cn } from "@/lib/utils"

// file-service file_contexts 시드와 같아야 한다(spec §8.2). 없으면 업로드가 404.
const SHOP_LISTING_IMAGE_CONTEXT_ID = "shop-listing-image"
const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp"

export function ImagePicker({
  value,
  onChange,
  invalid,
}: {
  value: string[]
  onChange: (next: string[]) => void
  invalid?: boolean
}) {
  const t = useTranslations("shopTrade.form")
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const add = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const room = MAX_SHOP_LISTING_IMAGES - value.length
    if (room <= 0) return
    const all = Array.from(files)
    const picked = all.slice(0, room)
    // 15장 제한에 걸려 일부만 담았으면 몇 장이 빠졌는지 바로 알려준다(그렇지 않으면 나머지가
    // 조용히 버려진 걸로 보인다).
    if (all.length > room) toast.error(t("tooManyImages", { count: room }))

    setUploading(true)
    try {
      // 폰 사진 원본은 업로드 서버 액션이 거치는 Lambda 프록시의 본문 상한을 base64 인코딩 뒤
      // 쉽게 넘는다(image-compress.ts 참고). 업로드 전에 무손실 webp 로 줄인다.
      const compressed = await Promise.all(picked.map((file) => compressImageForUpload(file)))
      const withinLimit = compressed.filter((result) => result.file.size <= MAX_UPLOAD_BYTES)
      if (withinLimit.length < compressed.length) toast.error(t("imageTooLarge"))
      if (withinLimit.length === 0) return

      // Promise.all 은 하나만 실패해도 나머지 성공분까지 버린다(file-service 고아 파일 + 전부 다시 선택).
      // allSettled 로 성공분은 순서대로 살리고, 실패가 하나라도 있으면 한 번만 알린다.
      const results = await Promise.allSettled(
        withinLimit.map(({ file }) => {
          const formData = new FormData()
          formData.append("file", file)
          formData.append("contextId", SHOP_LISTING_IMAGE_CONTEXT_ID)
          return uploadFile(formData)
        })
      )
      const uploaded = results
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof uploadFile>>> => r.status === "fulfilled")
        .map((r) => r.value.id)
      if (uploaded.length > 0) onChange([...value, ...uploaded])
      if (results.some((r) => r.status === "rejected")) toast.error(t("uploadFail"))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return
    const next = [...value]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(next)
  }

  return (
    <div className={cn("grid gap-2 rounded-lg", invalid && "ring-destructive ring-2 ring-offset-2")}>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {value.map((fileId, index) => (
          <li key={fileId} className="bg-muted relative aspect-square overflow-hidden rounded-lg">
            <Image src={getThumbnailUrl(fileId)} alt="" fill sizes="160px" className="object-cover" />
            <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/40 p-1">
              <button type="button" aria-label={t("moveUp")} onClick={() => move(index, index - 1)} className="p-1 text-white">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" aria-label={t("removeImage")} onClick={() => onChange(value.filter((id) => id !== fileId))} className="p-1 text-white">
                <X className="h-4 w-4" />
              </button>
              <button type="button" aria-label={t("moveDown")} onClick={() => move(index, index + 1)} className="p-1 text-white">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
        {value.length < MAX_SHOP_LISTING_IMAGES && (
          <li>
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="border-border text-muted-foreground flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-xs"
            >
              <ImagePlus className="h-5 w-5" />
              {t("addImage")}
            </button>
          </li>
        )}
      </ul>
      <p className="text-muted-foreground text-xs">{t("imagesHint")}</p>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        hidden
        onChange={(e) => void add(e.target.files)}
      />
    </div>
  )
}
