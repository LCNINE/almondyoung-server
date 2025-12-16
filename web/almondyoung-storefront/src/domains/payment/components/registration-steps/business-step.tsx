import { Spinner } from "@components/common/spinner"
import { Alert, AlertDescription } from "@components/common/ui/alert"
import { Badge } from "@components/common/ui/badge"
import { Button } from "@components/common/ui/button"
import { Checkbox } from "@components/common/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@components/common/ui/dialog"
import { Input } from "@components/common/ui/input"
import { Label } from "@components/common/ui/label"
import { zodResolver } from "@hookform/resolvers/zod"
import { HttpApiError } from "@lib/api/api-error"
import { uploadFile } from "@lib/api/file/upload"
import { createBusiness, updateBusiness } from "@lib/api/users/business"
import { FilesDto } from "@lib/types/dto/files"
import type { BusinessInfo } from "@lib/types/ui/user"
import { Clock } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useTransition } from "react"
import { Controller, useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { useBusinessVerification } from "../hooks/use-business-verification"

// 사업자 인증 스템 컴포넌트
export default function BusinessStep({
  status,
  rejectionReason,
  onComplete,
  businessInfo,
}: {
  status: "verified" | "rejected" | "under_review" | "none"
  rejectionReason: string | null
  onComplete: () => void
  businessInfo: BusinessInfo | null
}) {
  useEffect(() => {
    if (status === "verified") {
      onComplete()
    }
  }, [status, onComplete])

  if (status === "under_review") {
    return (
      <div className="py-8 text-center">
        <Clock className="text-muted-foreground mx-auto mb-4" />
        <p className="font-medium">사업자 인증 심사 중입니다</p>
        <p className="text-muted-foreground text-sm">
          영업일 기준 1~2일 내 완료됩니다
        </p>
      </div>
    )
  }

  if (status === "rejected") {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>반려 사유: {rejectionReason}</AlertDescription>
        </Alert>

        <BusinessForm onComplete={onComplete} businessInfo={businessInfo} />
      </div>
    )
  }

  return <BusinessForm onComplete={onComplete} businessInfo={businessInfo} />
}

const schema = z.object({
  businessNumber: z.string(),
  ceoName: z.string(),
  file: z.instanceof(File).optional(),
})

type BusinessFormData = z.infer<typeof schema>

function BusinessForm({
  onComplete,
  businessInfo,
}: {
  onComplete: () => void
  businessInfo: BusinessInfo | null
}) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 사업자 정보 등록
  const [isCreateBusinessPending, startCreateBusinessTransition] =
    useTransition()

  const form = useForm<BusinessFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      businessNumber: businessInfo?.businessNumber ?? "",
      ceoName: businessInfo?.representativeName ?? "",
      file: undefined,
    },
  })

  const {
    businessCheckStatus,
    isPending: isExternalBusinessPending,
    handleVerifyBusiness,
  } = useBusinessVerification({ form })

  const onSubmit = async (data: BusinessFormData) => {
    if (!businessCheckStatus && !form.watch("file")) {
      toast.error("사업자 정보 입력 또는 파일 첨부를 해주세요.")
      return
    }

    startCreateBusinessTransition(async () => {
      let fileRes: FilesDto | null = null

      if (form.watch("file")) {
        const formData = new FormData()

        formData.append("file", form.watch("file")!)
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

      if (businessInfo) {
        const res = await updateBusiness({
          business: {
            businessNumber: form.watch("businessNumber") ?? "",
            representativeName: form.watch("ceoName") ?? "",
            fileUrl: fileRes?.url ?? undefined,
          },
          businessId: businessInfo.id,
        })
      } else {
        const res = await createBusiness({
          businessNumber: form.watch("businessNumber") ?? "",
          representativeName: form.watch("ceoName") ?? "",
          fileUrl: fileRes?.url ?? undefined,
        })
      }
      router.refresh()

      // 파일 첨부면 business의 status가 under_review로 변경되므로 완료 처리하지 않음
      if (!form.watch("file")) {
        onComplete()
      }
    })
  }

  // 파일 첨부 버튼 클릭 핸들러
  const handleFileUploadClick = () => {
    if (businessCheckStatus === "success") {
      const confirmed = confirm(
        "이미 사업자 정보가 조회되었습니다. 파일을 첨부하시겠습니까?"
      )
      if (!confirmed) {
        return
      }
    }
    fileInputRef.current?.click()
  }

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit, (errors) => {
        const firstError = Object.values(errors)[0]

        toast.error(firstError?.message || "입력값을 확인해주세요")
      })}
      className="space-y-4"
    >
      <p className="bg-gray-10 px-4 py-2 text-sm text-gray-600">
        결제수단 등록을 위해서 본인인증을 진행해주세요. 아몬드영 인증 서비스를
        통해 안전하게 진행됩니다.
      </p>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold">사업자 확인</h2>
          <span>사업자 등록 상태를 조회합니다.</span>
        </div>
      </div>

      <div className="flex gap-4">
        <Controller
          name="businessNumber"
          control={form.control}
          render={({ field }) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="business-number-input">사업자등록번호</Label>
              <Input
                {...field}
                id="business-number-input"
                placeholder="000-00-00000"
                autoComplete="off"
                maxLength={12}
                inputMode="numeric"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleVerifyBusiness()
                  }
                }}
              />
            </div>
          )}
        />

        <Controller
          name="ceoName"
          control={form.control}
          render={({ field }) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="ceo-name-input">대표자 명</Label>
              <Input
                {...field}
                id="ceo-name-input"
                placeholder="대표자명(사업자등록증 표기)"
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    handleVerifyBusiness()
                  }
                }}
              />
            </div>
          )}
        />
      </div>

      <div className="flex items-center gap-2">
        {businessCheckStatus === "success" && (
          <Badge className="bg-green-500 text-white">조회 완료</Badge>
        )}
        {businessCheckStatus === "failed" && (
          <Badge className="bg-red-500 text-white">조회 실패</Badge>
        )}

        <Button
          type="button"
          className="ml-auto w-28"
          onClick={handleVerifyBusiness}
          disabled={isExternalBusinessPending}
        >
          {isExternalBusinessPending ? "조회 중..." : "조회"}
        </Button>
      </div>

      {/* 사업자 정보 없음 체크박스와 파일 업로드 UI */}
      <div className="rounded-md border p-4">
        {businessInfo?.fileUrl && !form.watch("file") && (
          <VerifiedAttachmentPreview fileUrl={businessInfo.fileUrl} />
        )}

        <Controller
          name="file"
          control={form.control}
          defaultValue={undefined}
          render={({ field }) => (
            <div className="">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="no-business-info-checkbox"
                  checked={!!field.value}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      handleFileUploadClick()
                    } else {
                      field.onChange(undefined)
                    }
                  }}
                  className="mr-2"
                />
                <Label
                  htmlFor="no-business-info-checkbox"
                  className="cursor-pointer text-sm font-medium"
                >
                  사업자 정보가 없어요
                </Label>

                <Button
                  type="button"
                  className="ml-auto w-20 cursor-pointer hover:bg-transparent hover:text-gray-900"
                  variant="outline"
                  onClick={handleFileUploadClick}
                >
                  파일첨부
                </Button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,application/pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]

                  if (file) {
                    // 파일 크기 체크 (예: 10MB)
                    if (file.size > 10 * 1024 * 1024) {
                      toast.error("파일 크기는 10MB 이하여야 합니다")
                      return
                    }

                    // 파일 타입 체크
                    const allowedTypes = [
                      "image/jpeg",
                      "image/jpg",
                      "image/png",
                      "application/pdf",
                    ]
                    if (!allowedTypes.includes(file.type)) {
                      toast.error("JPG, PNG, PDF 파일만 업로드 가능합니다")
                      return
                    }

                    field.onChange(file)
                  }
                }}
              />

              {/* 업로드된 파일 정보 표시 */}
              {field.value && (
                <div className="bg-gray-10 mt-2 flex items-center justify-between rounded-md p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">📎</span>
                    <span className="text-sm font-medium">
                      {field.value.name.length > 20
                        ? field.value.name.slice(0, 20) + "..."
                        : field.value.name}
                    </span>
                    <span className="text-xs text-gray-500">
                      ({(field.value.size / 1024).toFixed(1)} KB)
                    </span>
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      field.onChange(undefined)
                      if (fileInputRef.current) {
                        fileInputRef.current.value = ""
                      }
                    }}
                    className="h-6 px-2 text-xs text-red-500"
                  >
                    삭제
                  </Button>
                </div>
              )}
            </div>
          )}
        />
      </div>

      <Button
        type="submit"
        className="w-full bg-amber-500"
        disabled={isCreateBusinessPending}
      >
        {isCreateBusinessPending ? (
          <Spinner size="sm" color="white" />
        ) : (
          "다음 단계"
        )}
      </Button>
    </form>
  )
}

// 증빙 첨부파일 미리보기 컴포넌트
function VerifiedAttachmentPreview({ fileUrl }: { fileUrl: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <div className="bg-gray-10 mb-4 flex cursor-pointer items-center justify-between rounded-md p-3 transition-colors hover:bg-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">📎</span>
            <span className="text-sm font-medium">증빙 첨부 파일</span>
            <span className="text-xs text-gray-500">(클릭하여 크게 보기)</span>
          </div>
        </div>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogTitle className="sr-only">증빙 첨부 파일</DialogTitle>
        <div className="flex items-center justify-center">
          <img
            src={fileUrl}
            alt="사업자 증빙 파일"
            className="max-h-[80vh] w-auto rounded-lg object-contain"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
