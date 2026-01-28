"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import CustomRadio from "@/components/shared/custom-radio"
import type { CashReceiptData } from "@/lib/types/dto/wallet"
import { formatBusinessNumber } from "@/lib/utils/format-business-number"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useEffect, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { formatPhoneNumber } from "@/lib/utils/format-phone-number"

const cashReceiptSchema = z
  .object({
    type: z.enum(["business", "personal"]),
    name: z.string().min(1, "상호명/성명을 입력해주세요"),
    number: z.string().min(1, "번호를 입력해주세요"),
  })
  .superRefine((data, ctx) => {
    if (data.type === "business") {
      if (!/^\d{3}-\d{2}-\d{5}$/.test(data.number)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "올바른 사업자등록번호 형식이 아닙니다 (000-00-00000)",
          path: ["number"],
        })
      }
    } else {
      if (!/^01[0-9]-\d{4}-\d{4}$/.test(data.number)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "올바른 휴대폰번호 형식이 아닙니다 (010-0000-0000)",
          path: ["number"],
        })
      }
    }
  })

type CashReceiptFormData = z.infer<typeof cashReceiptSchema>

interface CashReceiptModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: CashReceiptData
  onSave?: (data: CashReceiptData) => void // 임시임 api 생기면 onSave 삭제하고 이 컴포넌트단에서 onSubmit 사용
}

export function CashReceiptModal({
  open,
  onOpenChange,
  initialData,
  onSave,
}: CashReceiptModalProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isValid },
  } = useForm<CashReceiptFormData>({
    resolver: zodResolver(cashReceiptSchema),
    mode: "onChange",
    defaultValues: {
      type: initialData?.type ?? "business",
      name: initialData?.name ?? "",
      number: initialData?.number ?? "",
    },
  })

  const receiptType = watch("type")
  const number = watch("number")

  useEffect(() => {
    if (open) {
      reset({
        type: initialData?.type ?? "business",
        name: initialData?.name ?? "",
        number: initialData?.number ?? "",
      })
    }
  }, [open, initialData, reset])

  // 타입 변경 시 번호 초기화
  useEffect(() => {
    setValue("number", "", { shouldValidate: false })
  }, [receiptType, setValue])

  const onSubmit = (data: CashReceiptFormData) => {
    startTransition(async () => {
      try {
        // TODO: API 연동 시 실제 저장 로직으로 교체
        if (onSave) {
          onSave(data)
        }

        onOpenChange(false)
        router.refresh()
      } catch (error) {
        toast.error("현금영수증 저장에 실패했습니다. 다시 시도해주세요.")
        console.error("현금영수증 저장 실패:", error)
      }
    })
  }

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted =
      receiptType === "business"
        ? formatBusinessNumber(e.target.value)
        : formatPhoneNumber(e.target.value)
    setValue("number", formatted, { shouldValidate: true })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>현금영수증 정보</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
          <div>
            <Label className="mb-2 block text-sm font-medium text-gray-700">
              발급 유형 <span className="text-red-500">*</span>
            </Label>
            <div className="flex items-center space-x-4">
              <CustomRadio
                label="사업자"
                name="receiptType"
                value="business"
                checked={receiptType === "business"}
                onChange={() =>
                  setValue("type", "business", { shouldValidate: true })
                }
              />
              <CustomRadio
                label="개인"
                name="receiptType"
                value="personal"
                checked={receiptType === "personal"}
                onChange={() =>
                  setValue("type", "personal", { shouldValidate: true })
                }
              />
            </div>
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-gray-700">
              {receiptType === "business" ? "상호명" : "성명"}{" "}
              <span className="text-red-500">*</span>
            </Label>
            <Input
              {...register("name")}
              placeholder={
                receiptType === "business"
                  ? "상호명을 입력하세요"
                  : "성명을 입력하세요"
              }
              className={errors.name ? "border-red-500" : ""}
              disabled={isPending}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>
            )}
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-gray-700">
              {receiptType === "business" ? "사업자등록번호" : "휴대폰번호"}{" "}
              <span className="text-red-500">*</span>
            </Label>
            <Input
              value={number}
              onChange={handleNumberChange}
              placeholder={
                receiptType === "business" ? "000-00-00000" : "010-0000-0000"
              }
              inputMode="numeric"
              className={errors.number ? "border-red-500" : ""}
              disabled={isPending}
            />
            {errors.number && (
              <p className="mt-1 text-xs text-red-500">
                {errors.number.message}
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              취소
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-[#F29219] hover:bg-[#F29219]/90"
              disabled={!isValid || isPending}
            >
              {isPending ? "저장 중..." : "저장"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
