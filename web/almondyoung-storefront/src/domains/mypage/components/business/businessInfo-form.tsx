"use client"

import { Spinner } from "@components/common/spinner"
import { Badge } from "@components/common/ui/badge"
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
} from "@lib/api/users/business/client"
import type { BusinessInfo } from "@lib/api/users/business/types"
import type { FilesDto } from "@lib/types/dto/files"
import { formatBusinessNumber } from "@lib/utils/format-business-number"
import { ViewMode } from "domains/mypage/template/business-info-template"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import BusinessFileManager from "./business-file-manager"
import { BusinessDtoSchema, businessDtoSchema } from "./schema"

interface BusinessInfoFormProps {
  initialData?: BusinessInfo | null
  onCancel: () => void
  viewMode: ViewMode
  setViewMode: (viewMode: ViewMode) => void
  isEditing?: boolean
}

export default function BusinessInfoForm({
  initialData,
  onCancel,
  viewMode,
  setViewMode,
  isEditing = false,
}: BusinessInfoFormProps) {
  const form = useForm<BusinessDtoSchema>({
    resolver: zodResolver(businessDtoSchema),
    mode: "onChange",
    defaultValues: {
      businessNumber: formatBusinessNumber(initialData?.businessNumber ?? ""),
      representativeName: initialData?.representativeName ?? "",
      fileUrl: initialData?.fileUrl ?? undefined,
      file: undefined,
      metadata: initialData?.metadata ?? undefined,
      isSubmitting: false,
    },
  })

  const [isSearchPending, startSearchTransition] = useTransition()
  const [isSubmitPending, startSubmitTransition] = useTransition()

  const router = useRouter()

  const handleSubmit = (data: BusinessDtoSchema) => {
    const { businessNumber, representativeName, fileUrl, file, metadata } = data

    if (!form.watch("isSubmitting")) {
      toast.info("사업자를 조회하시거나 새로운 파일을 첨부해주세요!")
      return
    }

    startSubmitTransition(async () => {
      let fileRes: FilesDto | null = null

      if (file) {
        const formData = new FormData()

        formData.append("file", file)
        formData.append("context", "business-verification-file")

        try {
          fileRes = await uploadFile(formData)
        } catch (error) {
          console.log("error:", error)
          if (error instanceof HttpApiError) {
            toast.error(error.message)
          } else {
            toast.error("파일 업로드 중 오류가 발생했습니다.")
          }

          return
        }
      }

      try {
        // 새로 등록
        if (viewMode === "register") {
          const res = await createBusiness({
            businessNumber,
            representativeName,
            fileUrl: fileRes?.data?.url,
            metadata,
          })

          router.refresh()
        } else if (viewMode === "edit") {
          // 기존 정보 수정
          if (!initialData?.id) {
            toast.error("사업자 정보를 찾을 수 없습니다.")
            return
          }

          // fileRes.data.url이 있으면 기존 사업자번호랑 대표자는 ''로 설정
          const res = await updateBusiness({
            business: {
              businessNumber: fileRes?.data.url ? "" : businessNumber,
              representativeName: fileRes?.data.url ? "" : representativeName,
              fileUrl: fileRes?.data?.url ?? "",
              metadata,
            },
            businessId: initialData?.id!,
          })
        }

        router.refresh()
        setViewMode("display")

        const toastMessage = (mode: ViewMode | "fileUpload") => {
          switch (mode) {
            case "register":
              return "사업자 정보 등록이 완료되었습니다."
            case "edit":
              return "사업자 정보 수정이 완료되었습니다."
            case "fileUpload":
              return "새로운 파일이 업로드 되었습니다. 관리자의 검토 후 승인 완료 됩니다."
          }
        }

        toast.success(toastMessage(fileRes?.data.url ? "fileUpload" : viewMode))
      } catch (error) {
        console.log("error:", error)
        if (error instanceof HttpApiError) {
          toast.error(error.message)
        } else {
          toast.error("오류가 발생했습니다.")
        }
      }
    })
  }

  // 사업자 정보 외부 조회
  const handleExternalBusinessInfo = () => {
    const businessNumber = form.getValues("businessNumber")
    const representativeName = form.getValues("representativeName")

    if (!businessNumber) {
      form.setError("businessNumber", {
        message: "사업자등록번호를 입력해주세요.",
      })
    }

    if (!representativeName) {
      form.setError("representativeName", {
        message: "대표자명을 입력해주세요.",
      })
    }

    if (
      form.formState.errors.businessNumber ||
      form.formState.errors.representativeName
    ) {
      form.setFocus(
        form.formState.errors.businessNumber?.message
          ? "businessNumber"
          : "representativeName"
      )
      return
    }

    startSearchTransition(async () => {
      try {
        const res = await fetchExternalBusinessInfo(
          businessNumber,
          representativeName
        )

        if (res.success) {
          toast.success(
            '사업자 정보 조회가 완료되었습니다. 아래 "등록하기" 버튼을 눌러 사업자 정보를 등록해주세요.'
          )
        }

        form.setValue("isSubmitting", true)
      } catch (error: any) {
        if (error instanceof HttpApiError) {
          switch (error.data.message) {
            case "사업자번호는 10자리이어야 합니다.":
              form.setError("businessNumber", {
                message: "사업자등록번호는 10자리이어야 합니다.",
              })
              form.setFocus("businessNumber")
              break
            case "대표자 이름이 일치하지 않습니다.":
              form.setError("representativeName", {
                message: "대표자 이름이 일치하지 않습니다.",
              })
              form.setFocus("representativeName")
              break
            default:
              toast.error(error.data.message)
          }
        } else {
          toast.error("조회 중 오류가 발생했습니다.")
        }
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <div className="grid gap-6 md:grid md:grid-cols-2">
          {/* 사업자등록번호 */}
          <FormField
            control={form.control}
            name="businessNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  사업자등록번호 <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="000-00-00000"
                    {...field}
                    onChange={(e) => {
                      const formatted = formatBusinessNumber(e.target.value)
                      field.onChange(formatted.replace(/\s/g, "")) // 공백 제거
                      form.clearErrors("businessNumber")
                      form.trigger("businessNumber")
                    }}
                    disabled={form.formState.dirtyFields.file}
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
                  대표자명 <span className="text-destructive">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="대표자명을 입력하세요"
                    {...field}
                    onChange={(e) => {
                      field.onChange(e.target.value.trim().replace(/\s/g, ""))
                      form.clearErrors("representativeName")
                    }}
                    disabled={form.formState.dirtyFields.file}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* todo : Badge 상태 관리 필요 */}
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="bg-gray-20 hover:bg-gray-30 px-2 py-1 text-xs"
          >
            <span className="font-normal">미조회</span>
          </Badge>

          <Button
            type="button"
            className="ml-auto min-w-[120px] flex-none"
            onClick={handleExternalBusinessInfo}
            disabled={
              isSearchPending || !!form.watch("file") || !!form.watch("fileUrl")
            }
          >
            {isSearchPending ? "조회 중..." : "조회하기"}
          </Button>
        </div>

        {/* 사업자등록증 첨부 파일 */}
        <BusinessFileManager
          isFilled={!!form.getValues("fileUrl") || !!form.getValues("file")}
        />

        <div className="animate-in fade-in-50 slide-in-from-bottom-2 flex justify-end gap-3 pt-4 duration-300">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              className="flex-1 md:min-w-[120px] md:flex-none"
            >
              취소
            </Button>
          )}

          <Button
            type="submit"
            className={`relative flex-1 md:min-w-[120px] md:flex-none`}
            disabled={isSubmitPending}
          >
            {isSubmitPending ? (
              <>
                <Spinner size="sm" color="white" /> 등록중 ..
              </>
            ) : isEditing ? (
              "수정하기"
            ) : (
              "등록하기"
            )}
          </Button>
        </div>
      </form>
    </Form>
  )
}
