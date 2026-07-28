"use client"

import { Spinner } from "@/components/shared/spinner"
import { Button } from "@components/common/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@components/common/ui/form"
import { Input } from "@components/common/ui/input"
import { zodResolver } from "@hookform/resolvers/zod"
import { HttpApiError } from "@lib/api/api-error"
import { uploadFile } from "@lib/api/file/upload"
import { createBusiness, updateBusiness } from "@lib/api/users/business"
import type { FilesDto } from "@lib/types/dto/files"
import type { BusinessInfoDto } from "@lib/types/dto/users"
import { formatBusinessNumber } from "@lib/utils/format-business-number"
import type { ViewMode } from "domains/business/template/business-info-template"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { useMemo, useState, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import BusinessFileUploader from "./business-file-uploader"
import { buildBusinessDtoSchema, BusinessDtoSchema } from "./schema"

interface BusinessInfoFormProps {
  initialData?: BusinessInfoDto | null
  onCancel: () => void
  viewMode: ViewMode
  setViewMode: (viewMode: ViewMode) => void
  isEditing?: boolean
}

export default function BusinessForm({
  initialData,
  onCancel,
  viewMode,
  setViewMode,
  isEditing = false,
}: BusinessInfoFormProps) {
  const t = useTranslations("business.form")

  const businessDtoSchema = useMemo(
    () =>
      buildBusinessDtoSchema({
        businessNumberRequired: t("businessNumberRequiredError"),
        representativeNameRequired: t("representativeNameRequiredError"),
        startDateRequired: t("startDateRequiredError"),
        startDateInvalid: t("startDateInvalidError"),
      }),
    [t]
  )

  const form = useForm<BusinessDtoSchema>({
    resolver: zodResolver(businessDtoSchema),
    mode: "onChange",
    defaultValues: {
      businessNumber: formatBusinessNumber(initialData?.businessNumber ?? ""),
      representativeName: initialData?.representativeName ?? "",
      // 개업일자는 저장하지 않으므로(진위확인 입력값일 뿐) 수정 시에도 다시 입력받는다.
      startDate: "",
      fileUrl: initialData?.fileUrl || undefined,
      file: undefined,
    },
  })
  const [isSubmitPending, startSubmitTransition] = useTransition()

  const router = useRouter()

  // 스텝 전환: false=번호/대표자 입력 화면, true=파일 첨부 화면
  // 기존 파일이 있으면 파일 스텝으로 시작.
  const [showFileUpload, setShowFileUpload] = useState(
    Boolean(initialData?.fileUrl)
  )

  // 파일 스텝에서 "이전" → 첨부한 파일을 리셋하고 번호/대표자 입력 화면으로 복귀.
  const handleBackToInfo = () => {
    form.setValue("file", undefined, { shouldValidate: true })
    form.setValue("fileUrl", undefined)
    setShowFileUpload(false)
  }


  const handleSubmit = (data: BusinessDtoSchema) => {
    const { businessNumber, representativeName, startDate, file } = data
    const normalizedStartDate = startDate?.replace(/\D/g, "") ?? ""

    if (showFileUpload && !file && !data.fileUrl) {
      toast.info(t("fileRequiredError"))
      return
    }

    if (initialData?.status === "approved") {
      const confirmed = window.confirm(
        "이미 승인된 사업자 정보가 있습니다. 수정하시면 재심사 대상이 됩니다. 계속하시겠습니까?"
      )

      if (!confirmed) return
    }

    startSubmitTransition(async () => {
      let fileRes: FilesDto | null = null

      if (file) {
        const formData = new FormData()

        formData.append("file", file)
        formData.append("contextId", "business-verification-file")

        try {
          fileRes = await uploadFile(formData)
        } catch (error) {
          console.log("error:", error)
          if (error instanceof HttpApiError) {
            toast.error(error.message)
          } else {
            toast.error(t("uploadError"))
          }

          return
        }
      }

      try {
        // 새로 등록
        if (viewMode === "register") {
          await createBusiness(
            showFileUpload
              ? { fileUrl: fileRes?.url }
              : {
                  businessNumber,
                  representativeName,
                  startDate: normalizedStartDate,
                }
          )

          router.refresh()
        } else if (viewMode === "edit") {
          // 기존 정보 수정
          if (!initialData?.id) {
            toast.error(t("notFoundError"))
            return
          }
          // 어떤 경로로 제출하는지는 "지금 보고 있는 스텝"이 정한다.
          // 예전엔 initialData.fileUrl 을 직접 읽어서, 파일로 등록했던 사용자가 "이전"으로
          // 돌아와 번호를 입력해도 옛 fileUrl 이 같이 실려 계속 서류 심사로만 처리됐다.
          await updateBusiness({
            business: showFileUpload
              ? { fileUrl: fileRes?.url ?? initialData.fileUrl ?? "" }
              : {
                  businessNumber,
                  representativeName,
                  startDate: normalizedStartDate,
                },
            businessId: initialData.id,
          })
        }

        router.refresh()
        setViewMode("display")

        const toastMessage = (mode: ViewMode | "fileUpload") => {
          switch (mode) {
            case "register":
              return t("registerSuccess")
            case "edit":
              return t("editSuccess")
            case "fileUpload":
              return t("fileUploadSuccess")
          }
        }

        toast.success(toastMessage(fileRes?.url ? "fileUpload" : viewMode))
      } catch (error) {
        console.log("error:", error)
        if (error instanceof HttpApiError) {
          toast.error(error.message)
        } else {
          toast.error(t("genericError"))
        }
      }
    })
  }

  // 서류 경로로 제출하면 서버가 business_number/representative_name 을 null 로 덮어쓴다.
  // 승인된 번호가 있는 사용자에겐 그 사실을 미리 알리고 전환 여부를 묻는다.
  const handleGoToDocument = () => {
    const willDiscardApproved =
      initialData?.status === "approved" && Boolean(initialData?.businessNumber)

    if (willDiscardApproved && !window.confirm(t("switchToDocumentConfirm"))) {
      return
    }

    setShowFileUpload(true)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {!showFileUpload ? (
          <>
            <div className="grid gap-6 md:grid md:grid-cols-2">
              {/* 사업자등록번호 */}
              <FormField
                control={form.control}
                name="businessNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("businessNumberLabel")}{" "}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        className="bg-background"
                        placeholder={t("businessNumberPlaceholder")}
                        {...field}
                        onChange={(e) => {
                          const formatted = formatBusinessNumber(e.target.value)
                          field.onChange(formatted.replace(/\s/g, "")) // 공백 제거
                          form.clearErrors("businessNumber")
                          form.trigger("businessNumber")
                        }}
                        maxLength={12}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 대표자명 */}
              <FormField
                control={form.control}
                name="representativeName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("representativeNameLabel")}{" "}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        className="bg-background"
                        placeholder={t("representativeNamePlaceholder")}
                        {...field}
                        onChange={(e) => {
                          field.onChange(
                            e.target.value.trim().replace(/\s/g, "")
                          )
                          form.clearErrors("representativeName")
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* 개업일자 — 국세청 진위확인에 사업자번호·대표자명과 함께 필요하다. */}
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("startDateLabel")}{" "}
                      <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        className="bg-background"
                        placeholder={t("startDatePlaceholder")}
                        inputMode="numeric"
                        maxLength={8}
                        {...field}
                        onChange={(e) => {
                          field.onChange(e.target.value.replace(/\D/g, ""))
                          form.clearErrors("startDate")
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <p className="text-muted-foreground text-xs leading-relaxed">
              {t("lookupHint")}
            </p>

            {/* 사업자등록번호로 인증이 어려우면 서류 첨부 스텝으로 전환 */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleGoToDocument}
                className="group text-foreground hover:bg-muted flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-dashed px-4 py-3 text-sm font-medium transition-colors"
              >
                <span className="underline-offset-4 group-hover:underline">
                  {t("orAttachFile")}
                </span>
                <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </>
        ) : (
          <div className="animate-in fade-in-50 slide-in-from-right-1 space-y-3 duration-200">
            <button
              type="button"
              onClick={handleBackToInfo}
              className="group text-foreground hover:bg-muted flex w-full cursor-pointer items-center gap-2 rounded-md px-4 py-3 text-sm font-medium transition-colors"
            >
              <ChevronLeft className="text-muted-foreground h-4 w-4 shrink-0 transition-transform group-hover:-translate-x-0.5" />
              <span className="underline-offset-4 group-hover:underline">
                {t("backButton")}
              </span>
            </button>
            <BusinessFileUploader />
          </div>
        )}

        {(
          <div className="animate-in fade-in-50 slide-in-from-bottom-2 flex justify-end gap-3 pt-4 duration-300">
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                className="flex-1 md:min-w-[120px] md:flex-none"
              >
                {t("cancelButton")}
              </Button>
            )}

            <Button
              type="submit"
              className={`relative flex-1 md:min-w-[120px] md:flex-none`}
              disabled={isSubmitPending}
            >
              {isSubmitPending ? (
                <>
                  <Spinner size="sm" color="white" /> {t("registerPending")}
                </>
              ) : isEditing ? (
                t("editButton")
              ) : (
                t("registerButton")
              )}
            </Button>
          </div>
        )}
      </form>
    </Form>
  )
}
