"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useMediaQuery } from "@/hooks/use-media-query"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { updateCart } from "@/lib/api/medusa/cart"
import {
  createCustomerShippingAddress,
  updateCustomerShippingAddress,
} from "@/lib/api/medusa/customer"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

const PHONE_MAX_LENGTH = 13
const INPUT_CLASSNAME = "h-12 rounded-md border border-gray-300 px-4"

/** 전화번호 포맷팅 (010-1234-5678 형식) */
const formatPhoneNumber = (value: string): string => {
  const numbers = value.replace(/\D/g, "")
  if (numbers.length <= 3) return numbers
  if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`
  return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`
}

/** 전화번호에서 숫자만 추출 */
const extractPhoneNumbers = (value: string): string => value.replace(/\D/g, "")

/** 이름을 firstName, lastName으로 분리 */
const splitName = (name: string): { firstName: string; lastName: string } => {
  const nameParts = name.trim().split(" ")
  return {
    firstName: nameParts[0] || "",
    lastName: nameParts.slice(1).join(" ") || "",
  }
}

/** 주소에서 province, city 추출 */
const extractAddressParts = (
  address: string
): { province: string; city: string } => {
  const addressParts = address.split(" ")
  return {
    province: addressParts[0] || "",
    city: addressParts[1] || "",
  }
}

const shippingAddressSchema = z.object({
  addressName: z.string().optional(),
  name: z.string().min(1, "받는 분 이름을 입력해주세요"),
  phone: z
    .string()
    .min(1, "휴대폰 번호를 입력해주세요")
    .refine(
      (val) => {
        const numbers = val.replace(/\D/g, "")
        return /^01[0-9]\d{7,8}$/.test(numbers)
      },
      { message: "올바른 휴대폰 번호를 입력해주세요" }
    ),
  postalCode: z.string().min(1, "우편번호를 입력해주세요"),
  address1: z.string().min(1, "기본주소를 입력해주세요"),
  address2: z.string().optional(),
  saveAsDefault: z.boolean().optional(),
})

type ShippingAddressFormData = z.infer<typeof shippingAddressSchema>

interface ShippingAddressModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode?: "create" | "edit"
  addressId?: string
  defaultValues?: {
    addressName?: string
    name?: string
    phone?: string
    postalCode?: string
    address1?: string
    address2?: string
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface AddressNameFieldProps {
  control: ReturnType<typeof useForm<ShippingAddressFormData>>["control"]
}

function AddressNameField({ control }: AddressNameFieldProps) {
  return (
    <FormField
      control={control}
      name="addressName"
      render={({ field }) => (
        <FormItem>
          <FormControl>
            <Input
              placeholder="배송지명 (예: 집, 회사)"
              className={INPUT_CLASSNAME}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

interface NameFieldProps {
  control: ReturnType<typeof useForm<ShippingAddressFormData>>["control"]
}

function NameField({ control }: NameFieldProps) {
  return (
    <FormField
      control={control}
      name="name"
      render={({ field }) => (
        <FormItem>
          <FormControl>
            <Input
              placeholder="받는 분 이름"
              className={INPUT_CLASSNAME}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

interface PhoneFieldProps {
  control: ReturnType<typeof useForm<ShippingAddressFormData>>["control"]
}

function PhoneField({ control }: PhoneFieldProps) {
  return (
    <FormField
      control={control}
      name="phone"
      render={({ field }) => (
        <FormItem>
          <FormControl>
            <Input
              placeholder="휴대폰 번호"
              className={INPUT_CLASSNAME}
              type="tel"
              inputMode="numeric"
              maxLength={PHONE_MAX_LENGTH}
              {...field}
              onChange={(e) => {
                const formatted = formatPhoneNumber(e.target.value)
                field.onChange(formatted)
              }}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

interface PostalCodeFieldProps {
  control: ReturnType<typeof useForm<ShippingAddressFormData>>["control"]
  onOpenPostcode: () => void
}

function PostalCodeField({ control, onOpenPostcode }: PostalCodeFieldProps) {
  return (
    <div className="flex gap-2">
      <FormField
        control={control}
        name="postalCode"
        render={({ field }) => (
          <FormItem className="flex-1">
            <FormControl>
              <Input
                placeholder="우편번호"
                className={INPUT_CLASSNAME}
                readOnly
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <Button
        type="button"
        variant="outline"
        className="h-12 shrink-0 px-4 hover:bg-transparent hover:text-black"
        onClick={onOpenPostcode}
      >
        주소 검색
      </Button>
    </div>
  )
}

interface AddressFieldsProps {
  control: ReturnType<typeof useForm<ShippingAddressFormData>>["control"]
}

function AddressFields({ control }: AddressFieldsProps) {
  return (
    <>
      <FormField
        control={control}
        name="address1"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <Input
                placeholder="기본주소"
                className={INPUT_CLASSNAME}
                readOnly
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="address2"
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <Input
                placeholder="상세주소 (선택)"
                className={INPUT_CLASSNAME}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  )
}

interface SaveAsDefaultFieldProps {
  control: ReturnType<typeof useForm<ShippingAddressFormData>>["control"]
  isEditMode: boolean
}

function SaveAsDefaultField({ control, isEditMode }: SaveAsDefaultFieldProps) {
  return (
    <FormField
      control={control}
      name="saveAsDefault"
      render={({ field }) => (
        <FormItem className="flex items-center gap-2 space-y-0">
          <FormControl>
            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
          <label
            htmlFor="saveAsDefault"
            className="cursor-pointer text-sm text-gray-700"
            onClick={() => field.onChange(!field.value)}
          >
            {isEditMode ? "기본 배송지로 설정" : "기본 배송지로 저장"}
          </label>
        </FormItem>
      )}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export function ShippingAddressModal({
  open,
  onOpenChange,
  mode = "create",
  addressId,
  defaultValues,
}: ShippingAddressModalProps) {
  const router = useRouter()
  const isDesktop = useMediaQuery("(min-width: 768px)")
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isEditMode = mode === "edit"

  const form = useForm<ShippingAddressFormData>({
    resolver: zodResolver(shippingAddressSchema),
    defaultValues: {
      addressName: "",
      name: "",
      phone: "",
      postalCode: "",
      address1: "",
      address2: "",
      saveAsDefault: !isEditMode,
    },
  })

  // 모달이 열릴 때 폼 리셋
  useEffect(() => {
    if (!open) return

    if (defaultValues) {
      form.reset({
        addressName: defaultValues.addressName ?? "",
        name: defaultValues.name ?? "",
        phone: defaultValues.phone
          ? formatPhoneNumber(defaultValues.phone)
          : "",
        postalCode: defaultValues.postalCode ?? "",
        address1: defaultValues.address1 ?? "",
        address2: defaultValues.address2 ?? "",
        saveAsDefault: !isEditMode,
      })
    } else {
      // 새 배송지 추가 시 빈 폼으로 리셋
      form.reset({
        addressName: "",
        name: "",
        phone: "",
        postalCode: "",
        address1: "",
        address2: "",
        saveAsDefault: true,
      })
    }
  }, [open, defaultValues, form, isEditMode])

  const handleSubmit = useCallback(
    async (data: ShippingAddressFormData) => {
      setIsSubmitting(true)

      try {
        // 데이터 변환 (동기 함수이므로 직접 호출)
        const { firstName, lastName } = splitName(data.name)
        const phoneNumber = extractPhoneNumbers(data.phone)
        const { province, city } = extractAddressParts(data.address1)

        if (isEditMode && addressId) {
          // 수정 모드: Customer 주소 업데이트
          const result = await updateCustomerShippingAddress(addressId, {
            address_name: data.addressName || undefined,
            first_name: firstName,
            last_name: lastName,
            phone: phoneNumber,
            province,
            city,
            address_1: data.address1,
            address_2: data.address2 ?? "",
            postal_code: data.postalCode,
            country_code: "kr",
            is_default_shipping: data.saveAsDefault,
          })

          if (!result.success) {
            console.error("배송지 수정 실패:", result.error)
            toast.error("배송지 수정에 실패했습니다.")
            setIsSubmitting(false)
            return
          }

          toast.success("배송지가 수정되었습니다.")
          onOpenChange(false)
          router.refresh()
          return
        }

        // 생성 모드: Cart 업데이트 + Customer 주소 생성
        await updateCart({
          shipping_address: {
            first_name: firstName,
            last_name: lastName,
            phone: phoneNumber,
            province,
            city,
            address_1: data.address1,
            address_2: data.address2 ?? "",
            postal_code: data.postalCode,
            country_code: "kr",
          },
          metadata: {
            shipping_address_name: data.addressName || null,
          },
        })

        if (data.saveAsDefault) {
          const result = await createCustomerShippingAddress({
            address_name: data.addressName || undefined,
            first_name: firstName,
            last_name: lastName,
            phone: phoneNumber,
            province,
            city,
            address_1: data.address1,
            address_2: data.address2 ?? "",
            postal_code: data.postalCode,
            country_code: "kr",
            is_default_shipping: true,
          })

          if (!result.success) {
            console.error("기본 배송지 저장 실패:", result.error)
            toast.error(
              "배송지는 저장되었지만, 기본 배송지 등록에 실패했습니다."
            )
            onOpenChange(false)
            setIsSubmitting(false)
            return
          }
        }

        toast.success(
          data.saveAsDefault
            ? "배송지가 기본 배송지로 저장되었습니다."
            : "배송지가 저장되었습니다."
        )
        onOpenChange(false)
        router.refresh()
      } catch (error) {
        console.error("배송지 저장 실패:", error)
        toast.error("배송지 저장에 실패했습니다. 다시 시도해주세요.")
      } finally {
        setIsSubmitting(false)
      }
    },
    [isEditMode, addressId, onOpenChange, router]
  )

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

  const modalTitle = useMemo(
    () => (isEditMode ? "배송지 수정" : "배송지 등록"),
    [isEditMode]
  )

  const submitButtonText = useMemo(() => {
    if (isSubmitting) {
      return isEditMode ? "수정 중..." : "저장 중..."
    }
    return isEditMode ? "수정" : "저장"
  }, [isSubmitting, isEditMode])

  const formContent = useMemo(
    () => (
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="space-y-4"
          id="shipping-address-form"
        >
          <AddressNameField control={form.control} />
          <NameField control={form.control} />
          <PhoneField control={form.control} />
          <PostalCodeField
            control={form.control}
            onOpenPostcode={handleOpenPostcode}
          />
          <AddressFields control={form.control} />
          <SaveAsDefaultField control={form.control} isEditMode={isEditMode} />
        </form>
      </Form>
    ),
    [form, handleSubmit, handleOpenPostcode, isEditMode]
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
            <Button
              type="submit"
              form="shipping-address-form"
              disabled={isSubmitting}
            >
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
          <Button
            type="submit"
            form="shipping-address-form"
            disabled={isSubmitting}
          >
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
