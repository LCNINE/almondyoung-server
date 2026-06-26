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
import {
  createBusiness,
  fetchExternalBusinessInfo,
  updateBusiness,
} from "@lib/api/users/business"
import type { FilesDto } from "@lib/types/dto/files"
import type { BusinessInfoDto } from "@lib/types/dto/users"
import { formatBusinessNumber } from "@lib/utils/format-business-number"
import type { ViewMode } from "domains/business/template/business-info-template"
import { CheckCircle2, ChevronLeft, ChevronRight, Info, X } from "lucide-react"
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
      }),
    [t]
  )

  const form = useForm<BusinessDtoSchema>({
    resolver: zodResolver(businessDtoSchema),
    mode: "onChange",
    defaultValues: {
      businessNumber: formatBusinessNumber(initialData?.businessNumber ?? ""),
      representativeName: initialData?.representativeName ?? "",
      fileUrl: initialData?.fileUrl ?? undefined,
      file: undefined,
      metadata: initialData?.metadata ?? undefined,
      nts: null,
      isSubmitting: false,
    },
  })
  const [isSearchPending, startSearchTransition] = useTransition()
  const [isSubmitPending, startSubmitTransition] = useTransition()

  const router = useRouter()

  // 파일 첨부 경로를 쓰는 동안에는 직접 입력(번호/대표자명)을 잠근다.
  // dirtyFields 대신 실제 값 기준이라 X 로 파일을 지우면 자동으로 다시 열린다.
  const isFileMode = Boolean(form.watch("file") || form.watch("fileUrl"))

  // 스텝 전환: false=번호/대표자 입력 화면, true=파일 첨부 화면
  // 기존 파일이 있으면 파일 스텝으로 시작.
  const [showFileUpload, setShowFileUpload] = useState(
    Boolean(initialData?.fileUrl)
  )

  // 파일 스텝에서 "이전" → 첨부한 파일을 리셋하고 번호/대표자 입력 화면으로 복귀.
  const handleBackToInfo = () => {
    form.setValue("file", undefined, { shouldValidate: true })
    form.setValue("fileUrl", undefined)
    form.setValue("isSubmitting", Boolean(form.getValues("nts")))
    setShowFileUpload(false)
  }

  // 조회를 했거나 파일이 있어야 등록/취소 버튼이 등장
  const showActions = Boolean(form.watch("nts")) || isFileMode

  const handleSubmit = (data: BusinessDtoSchema) => {
    const { businessNumber, representativeName, file, metadata } = data

    // 상태조회 결과를 metadata.nts 에 보관
    const nts = form.watch("nts")
    const mergedMetadata = nts != null ? { ...(metadata ?? {}), nts } : metadata

    if (initialData?.status === "approved") {
      const confirmed = window.confirm(
        "이미 승인된 사업자 정보가 있습니다. 수정하시면 재심사 대상이 됩니다. 계속하시겠습니까?"
      )

      if (!confirmed) return
    }

    if (!form.watch("isSubmitting")) {
      toast.info(t("fileRequiredError"))
      return
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
          await createBusiness({
            businessNumber,
            representativeName,
            fileUrl: fileRes?.url,
            metadata: mergedMetadata,
          })

          router.refresh()
        } else if (viewMode === "edit") {
          // 기존 정보 수정
          if (!initialData?.id) {
            toast.error(t("notFoundError"))
            return
          }
          // fileRes.data.url이 있으면 기존 사업자번호랑 대표자는 ''로 설정
          await updateBusiness({
            business: {
              businessNumber: fileRes?.url ? "" : businessNumber,
              representativeName: fileRes?.url ? "" : representativeName,
              fileUrl: fileRes?.url
                ? fileRes.url
                : initialData?.fileUrl
                  ? initialData.fileUrl
                  : "",
              metadata: mergedMetadata,
            },
            businessId: initialData?.id!,
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

  // 조회 결과 안내 — 이 페이지 전용 커스텀 토스트(전역 토스트 디자인은 건드리지 않음).
  const showLookupToast = (verified: boolean, detail?: string) => {
    toast.custom(
      (id) => (
        <div className="flex w-full items-start gap-3 rounded-xl border bg-white px-4 py-3 shadow-lg">
          {verified ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          ) : (
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
          )}
          <div className="text-sm">
            <p className="font-semibold text-gray-900">
              {verified ? "사업자 확인 완료" : "그대로 등록하실 수 있어요"}
            </p>
            {verified && detail && <p className="text-gray-500">{detail}</p>}
            <p className="mt-0.5 text-xs text-gray-500">
              {verified
                ? "자동으로 승인돼요. 아래 ‘등록하기’를 눌러주세요."
                : "관리자 확인 후 승인돼요. 아래 ‘등록하기’를 눌러주세요."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => toast.dismiss(id)}
            className="ml-auto text-gray-400 transition-colors hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ),

      { id: "business-lookup", duration: 7000 }
    )
  }

  // 사업자 정보 외부 조회 (국세청 상태조회). 사업자번호만 필요하며 결과와 무관하게 등록 가능.
  const handleExternalBusinessInfo = () => {
    const digits = form.getValues("businessNumber").replace(/\D/g, "")

    if (digits.length !== 10) {
      form.setError("businessNumber", {
        message:
          digits.length === 0
            ? t("businessNumberRequiredError")
            : t("businessNumberLengthError"),
      })
      form.setFocus("businessNumber")
      return
    }

    startSearchTransition(async () => {
      try {
        const nts = await fetchExternalBusinessInfo(digits)
        console.log("nts:", nts)
        form.setValue("nts", nts)
        form.setValue("isSubmitting", true) // 조회 결과와 무관하게 등록 허용

        // 번호 실존(계속/휴업/폐업) = 자동 승인 → 확인 토스트, 미등록/조회실패 → 안내 토스트
        const verified =
          nts.result === "active" ||
          nts.result === "suspended" ||
          nts.result === "closed"
        const raw = nts.raw ?? {}
        const detail = [raw.b_stt, raw.tax_type]
          .filter((v): v is string => typeof v === "string" && v.length > 0)
          .join(" · ")
        showLookupToast(verified, detail)
      } catch (error: any) {
        if (
          error?.digest === "UNAUTHORIZED" ||
          error?.message === "UNAUTHORIZED"
        ) {
          throw error
        }
        form.setValue("nts", {
          result: "lookup_failed",
          checkedAt: new Date().toISOString(),
        })
        form.setValue("isSubmitting", true)
        showLookupToast(false)
      }
    })
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
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault() // form submit 방지
                            handleExternalBusinessInfo()
                          }
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
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            handleExternalBusinessInfo()
                          }
                        }}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t("lookupHint")}
                </p>
                <Button
                  type="button"
                  className="w-full shrink-0 sm:w-28"
                  onClick={handleExternalBusinessInfo}
                  disabled={isSearchPending}
                >
                  {isSearchPending ? t("lookupPending") : t("lookupButton")}
                </Button>
              </div>
            </div>

            {/* 사업자등록번호가 없으면 파일 첨부 스텝으로 전환 */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowFileUpload(true)}
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
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm font-medium transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              {t("backButton")}
            </button>
            <BusinessFileUploader />
          </div>
        )}

        {/* 조회했거나 파일을 첨부해야 등록/취소 버튼이 나타난다. */}
        {showActions && (
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
