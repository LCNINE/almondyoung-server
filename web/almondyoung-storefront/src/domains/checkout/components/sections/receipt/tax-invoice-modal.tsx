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
import { updateTaxInvoice } from "@/lib/api/wallet"
import type { TaxInvoiceData } from "@/lib/types/dto/wallet"
import { formatBusinessNumber } from "@/lib/utils/format-business-number"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useEffect, useTransition } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

const taxInvoiceSchema = z.object({
  name: z.string().min(1, "상호명을 입력해주세요"),
  businessNumber: z
    .string()
    .min(1, "사업자등록번호를 입력해주세요")
    .regex(/^\d{3}-\d{2}-\d{5}$/, "올바른 사업자등록번호 형식이 아닙니다"),
  ownerName: z.string().min(1, "대표이사명을 입력해주세요"),
  address: z.string().min(1, "사업장 주소를 입력해주세요"),
})

type TaxInvoiceFormData = z.infer<typeof taxInvoiceSchema>

interface TaxInvoiceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialData?: TaxInvoiceData
}

export function TaxInvoiceModal({
  open,
  onOpenChange,
  initialData,
}: TaxInvoiceModalProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isValid },
  } = useForm<TaxInvoiceFormData>({
    resolver: zodResolver(taxInvoiceSchema),
    mode: "onChange",
    defaultValues: {
      name: initialData?.name ?? "",
      businessNumber: initialData?.businessNumber ?? "",
      ownerName: initialData?.ownerName ?? "",
      address: initialData?.address ?? "",
    },
  })

  useEffect(() => {
    if (open) {
      reset({
        name: initialData?.name ?? "",
        businessNumber: initialData?.businessNumber ?? "",
        ownerName: initialData?.ownerName ?? "",
        address: initialData?.address ?? "",
      })
    }
  }, [open, initialData, reset])

  const businessNumber = watch("businessNumber")

  const onSubmit = (data: TaxInvoiceFormData) => {
    startTransition(async () => {
      try {
        await updateTaxInvoice({
          defaultBusinessInfo: {
            name: data.name,
            businessNumber: data.businessNumber,
            ownerName: data.ownerName,
            address: data.address,
          },
          defaultEnabled: true,
        })
        toast.success("세금계산서 정보가 저장되었습니다")
        onOpenChange(false)
        router.refresh()
      } catch (error) {
        toast.error("저장에 실패했습니다. 다시 시도해주세요.")
        console.error("세금계산서 저장 실패:", error)
      }
    })
  }

  const handleBusinessNumberChange = (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const formatted = formatBusinessNumber(e.target.value)
    setValue("businessNumber", formatted, { shouldValidate: true })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>세금계산서 정보</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-4">
          <div>
            <Label className="mb-2 block text-sm font-medium text-gray-700">
              상호명 <span className="text-red-500">*</span>
            </Label>
            <Input
              {...register("name")}
              placeholder="상호명을 입력하세요"
              className={errors.name ? "border-red-500" : ""}
              disabled={isPending}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>
            )}
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-gray-700">
              사업자등록번호 <span className="text-red-500">*</span>
            </Label>
            <Input
              value={businessNumber}
              onChange={handleBusinessNumberChange}
              placeholder="000-00-00000"
              inputMode="numeric"
              className={errors.businessNumber ? "border-red-500" : ""}
              disabled={isPending}
            />
            {errors.businessNumber && (
              <p className="mt-1 text-xs text-red-500">
                {errors.businessNumber.message}
              </p>
            )}
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-gray-700">
              대표이사명 <span className="text-red-500">*</span>
            </Label>
            <Input
              {...register("ownerName")}
              placeholder="대표이사명을 입력하세요"
              className={errors.ownerName ? "border-red-500" : ""}
              disabled={isPending}
            />
            {errors.ownerName && (
              <p className="mt-1 text-xs text-red-500">
                {errors.ownerName.message}
              </p>
            )}
          </div>

          <div>
            <Label className="mb-2 block text-sm font-medium text-gray-700">
              사업장 주소 <span className="text-red-500">*</span>
            </Label>
            <Input
              {...register("address")}
              placeholder="사업장 주소를 입력하세요"
              className={errors.address ? "border-red-500" : ""}
              disabled={isPending}
            />
            {errors.address && (
              <p className="mt-1 text-xs text-red-500">
                {errors.address.message}
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
