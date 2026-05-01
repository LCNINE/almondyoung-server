"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Form } from "@/components/ui/form"
import {
  shopFormSchema,
  type ShopFormSchema,
  type ShopFormValues,
} from "@/components/shop-form/schema"
import { modifyShopSurvey } from "@/lib/api/users/shop-suvery"
import type { ShopInfoDto } from "@/lib/types/dto/users"
import { toLocalizedPath } from "@/lib/utils/locale-path"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import StepsManager from "./step-manger"

interface ShopSurveyFormProps {
  redirectTo: string
  initialData: ShopInfoDto | null
}

export default function ShopSurveyForm({
  redirectTo,
  initialData,
}: ShopSurveyFormProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const router = useRouter()
  const { countryCode } = useParams() as { countryCode?: string }
  const currentCountryCode = countryCode ?? "kr"

  const form = useForm<ShopFormValues>({
    resolver: zodResolver(shopFormSchema),
    mode: "onChange",
    defaultValues: {
      isOperating: initialData?.isOperating ?? undefined,
      yearsOperating: initialData?.yearsOperating ?? 0,
      shopType: initialData?.shopType ?? "",
      categories: initialData?.categories ?? [],
      targetCustomers: (initialData?.targetCustomers as string[]) ?? [],
      openDays: (initialData?.openDays as string[]) ?? [],
    },
  })

  const handleNext = () => {
    setCurrentStep((prev) => prev + 1)
  }

  const onSubmit = async (data: ShopFormSchema) => {
    const transformedData = {
      ...data,
      shopType: data.shopType ?? undefined,
    }

    const result = await modifyShopSurvey(transformedData)

    if (!result.success) {
      toast.error(result.error)
      return
    }

    toast.success("정보가 저장되었습니다.")
    router.push(toLocalizedPath(currentCountryCode, redirectTo || "/"))
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((data) => onSubmit(data as ShopFormSchema))}
        className="relative mx-auto flex w-full max-w-[600px] flex-col gap-10"
      >
        <StepsManager currentStep={currentStep} onNextStep={handleNext} />
      </form>
    </Form>
  )
}
