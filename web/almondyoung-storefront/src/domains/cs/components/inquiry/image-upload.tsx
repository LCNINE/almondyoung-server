"use client"

import Image from "next/image"
import { Camera, Plus, X } from "lucide-react"
import { useRef } from "react"

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

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const remaining = MAX_PHOTO_COUNT - images.length
    const newFiles = Array.from(files).slice(0, remaining)

    const validFiles = newFiles.filter((file) => {
      const sizeMB = file.size / (1024 * 1024)
      if (sizeMB > MAX_FILE_SIZE_MB) {
        alert(`${file.name}의 용량이 ${MAX_FILE_SIZE_MB}MB를 초과합니다.`)
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

      {images.length === 0 ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="flex w-full cursor-pointer flex-col items-center rounded-lg border border-dashed border-gray-300 px-4 py-5 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Camera className="mb-1 h-6 w-6 text-gray-500" />
          <p className="text-[15px] font-semibold text-gray-800">
            사진 첨부하기
          </p>
          <p className="mt-0.5 text-[13px] text-gray-500">
            최대 {MAX_PHOTO_COUNT}장, 각 {MAX_FILE_SIZE_MB}MB 이하
          </p>
        </button>
      ) : (
        <div className="rounded-lg border border-gray-200 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[13px] font-medium text-gray-700">
              사진 <span className="text-[#f29219]">{images.length}</span>/
              {MAX_PHOTO_COUNT}
            </p>
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {images.map((image) => (
              <div
                key={image.id}
                className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-gray-200"
              >
                <Image
                  src={image.previewUrl}
                  alt="첨부 이미지"
                  fill
                  className="object-cover"
                  sizes="80px"
                />
                <button
                  type="button"
                  onClick={() => handlePhotoRemove(image.id)}
                  disabled={disabled}
                  className="absolute top-0.5 right-0.5 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 disabled:cursor-not-allowed"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
            {images.length < MAX_PHOTO_COUNT && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled}
                className="flex h-20 w-20 shrink-0 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 transition-colors hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-5 w-5 text-gray-400" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
