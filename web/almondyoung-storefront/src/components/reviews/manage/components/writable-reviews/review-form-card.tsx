"use client"

import Image from "next/image"
import { Star, X, Camera, Plus } from "lucide-react"
import { useRef, useState } from "react"
import { useForm, useWatch, type Control } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@components/common/ui/card"
import { Button } from "@components/common/ui/button"
import { Separator } from "@components/common/ui/separator"
import { Textarea } from "@components/common/ui/textarea"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form"
import { toast } from "sonner"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"
import { uploadFile } from "@/lib/api/file/upload"
import type { WritableReview, ReviewInfo } from "../../types"
import type { RewardPolicy } from "@/lib/types/ui/ugc"
import { CustomButton } from "@/components/shared/custom-buttons"
import { ReviewImageModal } from "@/components/reviews/ui/review-image-modal"

interface ReviewFormCardProps {
  review: WritableReview
  rewardPolicies: RewardPolicy[]
  onSave: (data: ReviewInfo) => void
  onCancel: () => void
  isSaving?: boolean
}

const MAX_CONTENT_LENGTH = 5000
const MAX_PHOTO_COUNT = 5
const ACCEPTED_IMAGE_TYPES = "image/jpeg,image/png,image/webp"

interface PhotoPreview {
  id: string
  file: File
  previewUrl: string
}

function createReviewSchema(minContentLength: number) {
  return z.object({
    rating: z
      .number({ error: "별점을 선택해주세요." })
      .min(1, "별점을 선택해주세요.")
      .max(5),
    text: z
      .string()
      .min(minContentLength, `최소 ${minContentLength}자 이상 입력해주세요.`)
      .max(
        MAX_CONTENT_LENGTH,
        `최대 ${MAX_CONTENT_LENGTH.toLocaleString()}자까지 입력 가능합니다.`
      ),
  })
}

type ReviewFormValues = z.infer<ReturnType<typeof createReviewSchema>>

function TextCharCounter({
  control,
  maxLength,
}: {
  control: Control<ReviewFormValues>
  maxLength: number
}) {
  const text = useWatch({ control, name: "text" })
  return (
    <p className="text-[12px] text-gray-400">
      {text.length.toLocaleString()} / {maxLength.toLocaleString()}
    </p>
  )
}

export const ReviewFormCard = ({
  review,
  rewardPolicies,
  onSave,
  onCancel,
  isSaving = false,
}: ReviewFormCardProps) => {
  const [hoverRating, setHoverRating] = useState(0)
  const [photos, setPhotos] = useState<PhotoPreview[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const textPolicy = rewardPolicies.find((p) => p.reviewType === "TEXT")
  const photoPolicy = rewardPolicies.find((p) => p.reviewType === "PHOTO")
  const minContentLength = textPolicy?.minContentLength ?? 30
  const photoBonusAmount =
    photoPolicy && textPolicy
      ? photoPolicy.rewardAmount - textPolicy.rewardAmount
      : (photoPolicy?.rewardAmount ?? 0)

  const form = useForm<ReviewFormValues>({
    resolver: zodResolver(createReviewSchema(minContentLength)),
    mode: "onChange",
    defaultValues: {
      rating: 0,
      text: "",
    },
  })

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = form

  const isBusy = isSubmitting || isUploading || isSaving

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const remaining = MAX_PHOTO_COUNT - photos.length
    const newFiles = Array.from(files).slice(0, remaining)

    const newPreviews: PhotoPreview[] = newFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    }))

    setPhotos((prev) => [...prev, ...newPreviews])
    e.target.value = ""
  }

  const handlePhotoRemove = (id: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id)
      if (target) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((p) => p.id !== id)
    })
  }

  const uploadPhotos = async (): Promise<string[]> => {
    const results = await Promise.all(
      photos.map((photo) => {
        const formData = new FormData()
        formData.append("file", photo.file)
        formData.append("contextId", "review-media")
        return uploadFile(formData)
      })
    )
    return results.map((r) => r.id)
  }

  const onSubmit = async (data: ReviewFormValues) => {
    let mediaFileIds: string[] | undefined
    if (photos.length > 0) {
      setIsUploading(true)
      try {
        mediaFileIds = await uploadPhotos()
      } catch (error) {
        setIsUploading(false)
        toast.error("사진 업로드에 실패했습니다. 다시 시도해주세요.")
        return
      }
      setIsUploading(false)
    }
    onSave({
      rating: data.rating,
      text: data.text,
      mediaFileIds,
    })
  }

  return (
    <Card className="border-0 shadow-none">
      <article>
        <CardHeader className="flex flex-row items-start gap-3 p-4">
          <figure className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-[#F0F0F0]">
            <Image
              src={getThumbnailUrl(review.productImage)}
              alt={`${review.productName} 썸네일`}
              width={80}
              height={80}
              className="object-cover"
            />
          </figure>

          <div className="flex-1">
            <CardTitle className="line-clamp-2 text-[15px] leading-snug font-semibold">
              {review.productName}
            </CardTitle>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            aria-label="리뷰 작성 취소"
            className="h-8 w-8 shrink-0 text-gray-400"
          >
            <X className="h-5 w-5" />
          </Button>
        </CardHeader>

        <Separator className="mx-4 w-auto" />

        <CardContent className="p-4">
          <Form {...form}>
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="flex flex-col gap-4"
            >
              <FormField
                control={form.control}
                name="rating"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <div
                        className="flex items-center gap-1.5"
                        role="radiogroup"
                        aria-label="별점 평가"
                      >
                        <div
                          className="flex gap-0.5"
                          onMouseLeave={() => setHoverRating(0)}
                        >
                          {Array.from({ length: 5 }).map((_, index) => {
                            const ratingValue = index + 1
                            const isFilled =
                              (hoverRating || field.value) >= ratingValue
                            return (
                              <button
                                key={index}
                                type="button"
                                role="radio"
                                aria-checked={field.value === ratingValue}
                                aria-label={`${ratingValue}점`}
                                onClick={() => field.onChange(ratingValue)}
                                onMouseEnter={() => setHoverRating(ratingValue)}
                                className="cursor-pointer border-none bg-transparent p-0"
                              >
                                <Star
                                  className={`h-6 w-6 transition-colors ${
                                    isFilled
                                      ? "fill-[#FF9500] text-[#FF9500]"
                                      : "text-gray-300"
                                  }`}
                                />
                              </button>
                            )
                          })}
                        </div>
                        {field.value > 0 && (
                          <span className="text-lg font-bold text-gray-900">
                            {field.value}
                          </span>
                        )}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="text"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        {...field}
                        onChange={(e) => {
                          if (e.target.value.length <= MAX_CONTENT_LENGTH) {
                            field.onChange(e.target.value)
                          }
                        }}
                        placeholder={`최소 ${minContentLength}자 이상 입력해주세요.`}
                        className="min-h-[120px]"
                      />
                    </FormControl>
                    <div className="mt-1 flex items-center justify-between">
                      {textPolicy ? (
                        <p className="text-[12px] text-gray-400">
                          텍스트 리뷰{" "}
                          <span className="font-medium text-[#FF9500]">
                            {textPolicy.rewardAmount.toLocaleString()}원 적립
                          </span>{" "}
                          (최소 {minContentLength}자)
                        </p>
                      ) : (
                        <FormMessage />
                      )}
                      <TextCharCounter
                        control={form.control}
                        maxLength={MAX_CONTENT_LENGTH}
                      />
                    </div>
                    {textPolicy && <FormMessage />}
                  </FormItem>
                )}
              />

              {/* 사진 첨부 영역 */}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_IMAGE_TYPES}
                  multiple
                  className="hidden"
                  onChange={handlePhotoSelect}
                />

                {photos.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full cursor-pointer flex-col items-center rounded-lg border border-dashed border-gray-300 px-4 py-5 transition-colors hover:border-gray-400"
                  >
                    <Camera className="mb-1 h-6 w-6 text-gray-500" />
                    <p className="text-[15px] font-semibold text-gray-800">
                      사진 첨부하기
                    </p>
                    {photoPolicy && photoBonusAmount > 0 && (
                      <p className="mt-0.5 text-[13px] text-gray-500">
                        첨부하면{" "}
                        <span className="font-semibold text-emerald-500">
                          {photoBonusAmount.toLocaleString()}원 추가 적립!
                        </span>
                      </p>
                    )}
                  </button>
                ) : (
                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-[13px] font-medium text-gray-700">
                        사진{" "}
                        <span className="text-[#FF9500]">{photos.length}</span>/
                        {MAX_PHOTO_COUNT}
                      </p>
                      {photoPolicy && photoBonusAmount > 0 && (
                        <p className="text-[12px] font-medium text-emerald-500">
                          포토리뷰 {photoBonusAmount.toLocaleString()}원 추가
                          적립!
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2 overflow-x-auto">
                      {photos.map((photo) => (
                        <div
                          key={photo.id}
                          className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border border-gray-200"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewIndex(
                                photos.findIndex((p) => p.id === photo.id)
                              )
                              setPreviewOpen(true)
                            }}
                            className="h-full w-full cursor-pointer"
                          >
                            <Image
                              src={photo.previewUrl}
                              alt="리뷰 사진"
                              fill
                              className="object-cover"
                              sizes="80px"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePhotoRemove(photo.id)}
                            className="absolute top-0.5 right-0.5 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                      {photos.length < MAX_PHOTO_COUNT && (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="flex h-20 w-20 shrink-0 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 transition-colors hover:border-gray-400"
                        >
                          <Plus className="h-5 w-5 text-gray-400" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <p className="text-[11px] leading-relaxed text-red-400">
                최초 등록된 리뷰에 첨부된 사진 기준으로 포인트 적립되며, 상품과
                무관한 첨부파일은 삭제 및 적립혜택이 회수됩니다.
              </p>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  disabled={isBusy}
                >
                  취소
                </Button>
                <CustomButton
                  type="submit"
                  disabled={isBusy}
                  isLoading={isUploading || isBusy}
                >
                  등록
                </CustomButton>
              </div>
            </form>
          </Form>
        </CardContent>
      </article>

      <ReviewImageModal
        images={photos.map((p) => p.previewUrl)}
        startIndex={previewIndex}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </Card>
  )
}
