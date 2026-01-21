import { z } from "zod"
import { EditAddressState } from "../types"

export const shippingAddressSchema = z.object({
  addressName: z.string().optional(),
  name: z.string().min(1, "받는 분 이름을 입력해주세요"),
  phone: z
    .string()
    .min(1, "휴대폰 번호를 입력해주세요")
    .refine((val) => /^01[0-9]\d{7,8}$/.test(val.replace(/\D/g, "")), {
      message: "올바른 휴대폰 번호를 입력해주세요",
    }),
  postalCode: z.string().min(1, "우편번호를 입력해주세요"),
  address1: z.string().min(1, "기본주소를 입력해주세요"),
  address2: z.string().optional(),
  saveAsDefault: z.boolean().optional(),
})

export type ShippingAddressFormData = z.infer<typeof shippingAddressSchema>

export interface ShippingAddressModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode?: "create" | "edit"
  addressId?: string
  defaultValues?: EditAddressState["defaultValues"]
  onSuccess?: () => void
}
