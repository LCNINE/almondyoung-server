"use client"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useUser } from "@/contexts/user-context"
import { uploadFile } from "@/lib/api/file/upload"
import { createQuestion } from "@/lib/api/ugc/qna"
import type { QuestionCategory } from "@/lib/types/dto/ugc"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMemo, useState, useTransition } from "react"
import { useForm, useWatch, type Control } from "react-hook-form"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import {
  buildInquiryFormSchema,
  MAX_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  MIN_CONTENT_LENGTH,
  type InquiryFormValues,
} from "../../schemas/inquiry-schema"
import { CategorySelect } from "./category-select"
import { ImageUpload, type ImagePreview } from "./image-upload"

function ContentCharCounter({
  control,
  maxLength,
}: {
  control: Control<InquiryFormValues>
  maxLength: number
}) {
  const content = useWatch({ control, name: "content" })
  return (
    <p className="text-[12px] text-gray-400">
      {(content?.length ?? 0).toLocaleString()} / {maxLength.toLocaleString()}
    </p>
  )
}

interface InquiryFormProps {
  productId?: string
  productTitle?: string
  onSuccess?: () => void
}

export function InquiryForm({
  productId,
  productTitle,
  onSuccess,
}: InquiryFormProps) {
  const { user } = useUser()
  const t = useTranslations("cs.inquiry")
  const tForm = useTranslations("cs.inquiry.form")
  const tValidation = useTranslations("cs.inquiry.form.validation")
  const [images, setImages] = useState<ImagePreview[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const [isPending, startTransition] = useTransition()

  const schema = useMemo(
    () =>
      buildInquiryFormSchema({
        categoryRequired: tValidation("categoryRequired"),
        subCategoryRequired: tValidation("subCategoryRequired"),
        titleRequired: tValidation("titleRequired"),
        titleMax: tValidation("titleMax", { max: MAX_TITLE_LENGTH }),
        contentMin: tValidation("contentMin", { min: MIN_CONTENT_LENGTH }),
        contentMax: tValidation("contentMax", {
          max: MAX_CONTENT_LENGTH.toLocaleString(),
        }),
      }),
    [tValidation]
  )

  const form = useForm<InquiryFormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
    defaultValues: {
      category: undefined,
      subCategory: "",
      title: "",
      content: "",
    },
  })

  const {
    handleSubmit,
    formState: { isSubmitting },
    setValue,
    watch,
  } = form

  const category = watch("category")
  const subCategory = watch("subCategory")

  const isBusy = isSubmitting || isUploading || isPending

  const uploadImages = async (): Promise<string[]> => {
    const results = await Promise.all(
      images.map((img) => {
        const formData = new FormData()
        formData.append("file", img.file)
        formData.append("contextId", "cs-inquiry")
        formData.append("isPublic", "true")
        return uploadFile(formData)
      })
    )
    return results.map((r) => r.id)
  }

  const onSubmit = (data: InquiryFormValues) => {
    startTransition(async () => {
      try {
        let mediaFileIds: string[] | undefined

        if (images.length > 0) {
          setIsUploading(true)
          try {
            mediaFileIds = await uploadImages()
          } catch {
            setIsUploading(false)
            toast.error(t("uploadFail"))
            return
          }
          setIsUploading(false)
        }

        await createQuestion({
          nickname: user?.nickname ?? t("defaultNickname"),
          productId: productId,
          category: data.category,
          subCategory: data.subCategory,
          title: data.title,
          content: data.content,
          mediaFileIds,
        })

        form.reset()
        setImages([])
        onSuccess?.()
      } catch (error: unknown) {
        const err = error as Error & { digest?: string }
        if (err.digest === "UNAUTHORIZED" || err.message === "UNAUTHORIZED") {
          throw error
        }
        toast.error(t("submitFail"))
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
        {productTitle && (
          <p className="text-sm">
            <span className="font-medium text-gray-500">{tForm("productLabel")}</span>
            <span className="mx-2 text-gray-300">|</span>
            <span className="text-gray-900">{productTitle}</span>
          </p>
        )}

        <FormField
          control={form.control}
          name="category"
          render={() => (
            <FormItem>
              <FormLabel className="text-sm font-medium">
                {tForm("categoryLabel")} <span className="text-red-500">*</span>
              </FormLabel>
              <FormControl>
                <CategorySelect
                  category={category ?? ""}
                  subCategory={subCategory}
                  onCategoryChange={(value: QuestionCategory) =>
                    setValue("category", value, { shouldValidate: true })
                  }
                  onSubCategoryChange={(value: string) =>
                    setValue("subCategory", value, { shouldValidate: true })
                  }
                  disabled={isBusy}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="subCategory"
          render={() => (
            <FormItem className="hidden">
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">
                {tForm("titleLabel")} <span className="text-red-500">*</span>
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={tForm("titlePlaceholder")}
                  className="h-11 bg-white text-gray-900"
                  disabled={isBusy}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">
                {tForm("contentLabel")} <span className="text-red-500">*</span>
              </FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  onChange={(e) => {
                    if (e.target.value.length <= MAX_CONTENT_LENGTH) {
                      field.onChange(e.target.value)
                    }
                  }}
                  placeholder={tForm("contentPlaceholder", { min: MIN_CONTENT_LENGTH })}
                  className="min-h-[180px] resize-none"
                  disabled={isBusy}
                />
              </FormControl>
              <div className="mt-1 flex items-center justify-between">
                <FormMessage />
                <ContentCharCounter
                  control={form.control}
                  maxLength={MAX_CONTENT_LENGTH}
                />
              </div>
            </FormItem>
          )}
        />

        <div>
          <p className="mb-2 text-sm font-medium">{tForm("imageSectionLabel")}</p>
          <ImageUpload
            images={images}
            onImagesChange={setImages}
            disabled={isBusy}
          />
        </div>

        <div className="mt-2">
          <Button
            type="submit"
            disabled={isBusy}
            className="h-12 w-full bg-[#f29219] text-base font-bold hover:bg-[#e08010]"
          >
            {isBusy ? tForm("processing") : tForm("submit")}
          </Button>
        </div>
      </form>
    </Form>
  )
}
