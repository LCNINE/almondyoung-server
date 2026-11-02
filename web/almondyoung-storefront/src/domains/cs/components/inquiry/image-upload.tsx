"use client"

import { Camera, X } from "lucide-react"
import { useRef } from "react"
import { useTranslations } from "next-intl"

const MAX_PHOTO_COUNT = 3
const MAX_FILE_SIZE_MB = 10
const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp"

export interface ImagePreview {
  id: string
  file: File
  previewUrl: string
}

interface ImageUploadProps {
  images: ImagePreview[]
  onImagesChange: (images: ImagePreview[]) => void
  disabled?: boolean
}

export function ImageUpload({
  images,
  onImagesChange,
  disabled = false,
}: ImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const t = useTranslations("cs.inquiry")
  const tForm = useTranslations("cs.inquiry.form")

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const remaining = MAX_PHOTO_COUNT - images.length
    const newFiles = Array.from(files).slice(0, remaining)

    const validFiles = newFiles.filter((file) => {
      const sizeMB = file.size / (1024 * 1024)
      if (sizeMB > MAX_FILE_SIZE_MB) {
        alert(t("fileSizeOver", { name: file.name, size: MAX_FILE_SIZE_MB }))
        return false
      }
      return true
    })

    const newPreviews: ImagePreview[] = validFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }))

    onImagesChange([...images, ...newPreviews])
    e.target.value = ""
  }

  const handlePhotoRemove = (id: string) => {
    const target = images.find((p) => p.id === id)
    if (target) URL.revokeObjectURL(target.previewUrl)
    onImagesChange(images.filter((p) => p.id !== id))
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES}
        multiple
        className="hidden"
        onChange={handlePhotoSelect}
        disabled={disabled}
      />

      <div className="flex flex-wrap gap-2">
        {images.length < MAX_PHOTO_COUNT && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            aria-label={tForm("addPhoto")}
            className="bg-muted border-border text-muted-foreground flex h-20 w-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border transition-colors duration-150 hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Camera className="h-5 w-5" />
            <span className="text-xs">
              {images.length}/{MAX_PHOTO_COUNT}
            </span>
          </button>
        )}
        {images.map((image) => (
          <div
            key={image.id}
            className="border-border relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border"
          >
            <img
              src={image.previewUrl}
              alt={tForm("photoAlt")}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <button
              type="button"
              onClick={() => handlePhotoRemove(image.id)}
              disabled={disabled}
              aria-label={tForm("removePhoto")}
              className="absolute top-1 right-1 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 disabled:cursor-not-allowed"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {tForm("addPhotoHint", {
          max: MAX_PHOTO_COUNT,
          sizeMB: MAX_FILE_SIZE_MB,
        })}
      </p>
    </div>
  )
}
