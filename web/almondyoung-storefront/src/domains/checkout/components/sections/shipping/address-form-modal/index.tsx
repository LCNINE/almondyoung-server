"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Form } from "@/components/ui/form"
import { useMediaQuery } from "@/hooks/use-media-query"
import {
  createCustomerShippingAddress,
  updateCustomerShippingAddress,
} from "@/lib/api/medusa/customer"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import { formatPhoneNumber } from "@/lib/utils/format-phone-number"
import {
  FormTextField,
  PhoneField,
  PostalCodeField,
  SaveAsDefaultField,
} from "./form-fields"
import {
  shippingAddressSchema,
  type ShippingAddressFormData,
  type ShippingAddressModalProps,
} from "./schema"
import { transformFormDataToAddress } from "./utils"

export function ShippingAddressModal({
  open,
  onOpenChange,
  mode = "create",
  addressId,
  defaultValues,
  onSuccess,
}: ShippingAddressModalProps) {
  const router = useRouter()
  const isDesktop = useMediaQuery("(min-width: 768px)")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isEditMode = mode === "edit"
  const modalTitle = isEditMode ? "배송지 수정" : "배송지 등록"
  const submitButtonText = isSubmitting
    ? isEditMode
      ? "수정 중..."
      : "저장 중..."
    : isEditMode
      ? "수정"
      : "저장"

  const form = useForm<ShippingAddressFormData>({
    resolver: zodResolver(shippingAddressSchema),
    defaultValues: {
      addressName: "",
      name: "",
      phone: "",
      postalCode: "",
      address1: "",
      address2: "",
      saveAsDefault: defaultValues?.isDefaultShipping ?? false,
    },
  })

  // 모달 열릴 때 폼 초기화
  useEffect(() => {
    if (!open) return

    form.reset({
      addressName:
        (defaultValues?.metadata.shipping_address_name as string) ?? "",
      name: defaultValues?.name ?? "",
      phone: defaultValues?.phone ? formatPhoneNumber(defaultValues.phone) : "",
      postalCode: defaultValues?.postalCode ?? "",
      address1: defaultValues?.address1 ?? "",
      address2: defaultValues?.address2 ?? "",
      saveAsDefault: defaultValues?.isDefaultShipping ?? false,
    })
  }, [open, defaultValues, form, isEditMode])

  // 배송지 수정
  const handleUpdate = useCallback(
    async (data: ShippingAddressFormData) => {
      console.log("data:", data)
      if (!addressId) return false

      const addressData = transformFormDataToAddress(data)
      const result = await updateCustomerShippingAddress(addressId, {
        ...addressData,
        is_default_shipping: data.saveAsDefault,
      })

      if (!result.success) {
        toast.error("배송지 수정에 실패했습니다.")
        return false
      }

      toast.success("배송지가 수정되었습니다.")
      return true
    },
    [addressId]
  )

  const handleCreate = useCallback(async (data: ShippingAddressFormData) => {
    const addressData = transformFormDataToAddress(data)

    const result = await createCustomerShippingAddress({
      ...addressData,
      is_default_shipping: data.saveAsDefault ?? false,
    })

    if (!result.success) {
      toast.error("배송지 등록에 실패했습니다.")
      return false
    }

    toast.success(
      data.saveAsDefault
        ? "배송지가 기본 배송지로 등록되었습니다."
        : "배송지가 등록되었습니다."
    )
    return true
  }, [])

  const handleSubmit = useCallback(
    async (data: ShippingAddressFormData) => {
      setIsSubmitting(true)

      try {
        const success = isEditMode
          ? await handleUpdate(data)
          : await handleCreate(data)

        if (success) {
          onOpenChange(false)
          router.refresh()
          onSuccess?.()
        }
      } catch (error) {
        console.error("배송지 저장 실패:", error)
        toast.error("배송지 저장에 실패했습니다. 다시 시도해주세요.")
      } finally {
        setIsSubmitting(false)
      }
    },
    [isEditMode, handleUpdate, handleCreate, onOpenChange, router, onSuccess]
  )

  // 우편번호 검색
  const handleOpenPostcode = useCallback(() => {
    if (typeof window === "undefined") return

    const daum = (
      window as Window & {
        daum?: {
          Postcode: new (options: {
            oncomplete: (data: {
              zonecode: string
              roadAddress?: string
              jibunAddress?: string
            }) => void
          }) => { open: () => void }
        }
      }
    ).daum

    if (!daum?.Postcode) {
      toast.error(
        "우편번호 검색 서비스를 불러오는 중입니다. 잠시 후 다시 시도해주세요."
      )
      return
    }

    new daum.Postcode({
      oncomplete: (data) => {
        form.setValue("postalCode", data.zonecode)
        form.setValue("address1", data.roadAddress ?? data.jibunAddress ?? "")
        form.clearErrors(["postalCode", "address1"])
      },
    }).open()
  }, [form])

  const formContent = (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-4"
        id="address-form"
      >
        <FormTextField
          control={form.control}
          name="addressName"
          placeholder="배송지명(선택사항) (예: 집, 회사)"
        />
        <FormTextField
          control={form.control}
          name="name"
          placeholder="받는 분 이름"
        />
        <PhoneField control={form.control} />
        <PostalCodeField
          control={form.control}
          onOpenPostcode={handleOpenPostcode}
        />
        <FormTextField
          control={form.control}
          name="address1"
          placeholder="기본주소"
          readOnly
        />
        <FormTextField
          control={form.control}
          name="address2"
          placeholder="상세주소 (선택)"
        />
        <SaveAsDefaultField control={form.control} isEditMode={isEditMode} />
      </form>
    </Form>
  )

  // Desktop: Dialog
  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{modalTitle}</DialogTitle>
          </DialogHeader>
          <div className="py-4">{formContent}</div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              취소
            </Button>
            <Button type="submit" form="address-form" disabled={isSubmitting}>
              {submitButtonText}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // Mobile: Drawer
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle>{modalTitle}</DrawerTitle>
        </DrawerHeader>
        <div className="px-4">{formContent}</div>
        <DrawerFooter className="pt-4">
          <Button type="submit" form="address-form" disabled={isSubmitting}>
            {submitButtonText}
          </Button>
          <DrawerClose asChild>
            <Button variant="outline" disabled={isSubmitting}>
              취소
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
