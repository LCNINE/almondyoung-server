"use client"

import { CustomButton } from "@/components/shared/custom-buttons"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
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
    <p className="text-muted-foreground shrink-0 text-xs">
      {(content?.length ?? 0).toLocaleString()}/{maxLength.toLocaleString()}
    </p>
  )
}

interface InquiryFormProps {
  productId?: string
  productTitle?: string
  /** 주문에서 들어오면 주문 칩으로 보이고 제목에 붙는다 */
  orderNumber?: string
  onSuccess?: () => void
}

export function InquiryForm({
  productId,
  productTitle,
  orderNumber,
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

  // 제목 칸은 두지 않는다. 유형은 관리자 목록에 따로 보이므로 주문번호나 내용 첫 줄을 제목으로 쓴다
  const buildTitle = (data: InquiryFormValues) => {
    const firstLine =
      data.content
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean) ?? ""
    const title = orderNumber
      ? tForm("autoTitleWithOrder", { orderNumber })
      : firstLine

    return title.slice(0, MAX_TITLE_LENGTH)
  }

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
          title: buildTitle(data),
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
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-6">
        {(orderNumber || productTitle) && (
          <dl className="bg-muted flex flex-col gap-1 rounded-lg px-4 py-3 text-sm">
            {orderNumber && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground">{tForm("orderLabel")}</dt>
                <dd className="text-foreground font-medium">{orderNumber}</dd>
              </div>
            )}
            {productTitle && (
              <div className="flex gap-2">
                <dt className="text-muted-foreground shrink-0">
                  {tForm("productLabel")}
                </dt>
                <dd className="text-foreground min-w-0 truncate font-medium">
                  {productTitle}
                </dd>
              </div>
            )}
          </dl>
        )}

        <FormField
          control={form.control}
          name="category"
          render={() => (
            <FormItem className="gap-3">
              <FormLabel className="text-foreground text-sm font-bold">
                {tForm("categoryLabel")}
              </FormLabel>
              <FormControl>
                <CategorySelect
                  category={category ?? ""}
                  subCategory={subCategory}
                  onCategoryChange={(value: QuestionCategory) =>
                    setValue("category", value, { shouldValidate: true })
                  }
                  onSubCategoryChange={(value: string) =>
                    // 대분류를 바꿔 비울 때는 아직 고를 기회를 주고 검사하지 않는다
                    setValue("subCategory", value, {
                      shouldValidate: value !== "",
                    })
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
            <FormItem className="-mt-4 empty:hidden">
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem className="gap-2">
              <FormLabel className="text-foreground text-sm font-bold">
                {tForm("contentLabel")}
              </FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  onChange={(e) => {
                    if (e.target.value.length <= MAX_CONTENT_LENGTH) {
                      field.onChange(e.target.value)
                    }
                  }}
                  placeholder={tForm("contentPlaceholder")}
                  className="bg-muted border-border min-h-[160px] resize-none rounded-lg p-4 text-sm leading-6 placeholder:text-[#b0b3ba]"
                  disabled={isBusy}
                />
              </FormControl>
              <div className="flex items-start justify-between gap-4">
                {form.formState.errors.content ? (
                  <FormMessage className="text-xs" />
                ) : (
                  <p className="text-muted-foreground text-xs">
                    {tForm("contentHelper", { min: MIN_CONTENT_LENGTH })}
                  </p>
                )}
                <ContentCharCounter
                  control={form.control}
                  maxLength={MAX_CONTENT_LENGTH}
                />
              </div>
            </FormItem>
          )}
        />

        <div className="flex flex-col gap-2">
          <p className="text-foreground text-sm font-bold">
            {tForm("imageSectionLabel")}
            <span className="text-muted-foreground ml-1 text-[13px] font-normal">
              {tForm("optional")}
            </span>
          </p>
          <ImageUpload
            images={images}
            onImagesChange={setImages}
            disabled={isBusy}
          />
        </div>

        <CustomButton
          type="submit"
          color="primary"
          disabled={isBusy}
          className="h-[52px] w-full rounded-xl text-base font-bold"
        >
          {isBusy ? tForm("processing") : tForm("submit")}
        </CustomButton>
      </form>
    </Form>
  )
}
