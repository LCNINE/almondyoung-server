import type { ShopFormSchema } from "./schema"

export interface ShopSettingFormValues {
  isOperating: boolean
  yearsOperating: number
  shopSize: "1인샵" | "2~3인 소형샵" | "4인 이상 중형/대형샵"
  treatments: string[]
  targetCustomers: string[]
  openDays: string[]
}

export type ShopFormSubmitHandler = (data: ShopFormSchema) => Promise<void>
