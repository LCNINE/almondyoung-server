"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Form } from "@components/common/ui/form"

import { useShopSurvey } from "@components/shop-survey/hooks/use-shop-survey"
import {
  ShopSurveySchema,
  shopSurveySchema,
} from "@components/shop-survey/schemas/suvery-schema"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import ShopSurveySkeleton from "../skeleton"
import StepsManager from "./step-manger"

export default function ShopSurveyForm({
  redirectTo,
}: {
  redirectTo: string | undefined
}) {
  const [currentStep, setCurrentStep] = useState(0)
  const { modifyShopSurvey, isLoading, getShopSurvey } = useShopSurvey()

  const router = useRouter()

  const form = useForm<ShopSurveySchema>({
    resolver: zodResolver(shopSurveySchema),
    mode: "onChange",
    defaultValues: {
      isOperating: undefined,
      yearsOperating: 0,
      shopType: "",
      categories: [],
      targetCustomers: [],
      openDays: [],
    },
  })

  const handleNext = () => {
    setCurrentStep((prev) => prev + 1)
  }

  const handlePrev = () => {
    setCurrentStep((prev) => prev - 1)
  }

  const onSubmit = async (data: ShopSurveySchema) => {
    const res = await modifyShopSurvey(data)

    if (res.success) {
      toast.success("정보가 저장되었습니다.")
      router.push(redirectTo ?? "/")
    }
  }

  useEffect(() => {
    const getShopSurveyData = async () => {
      const res = await getShopSurvey()
      form.reset(res)
    }
    getShopSurveyData()
  }, [])

  if (isLoading) {
    return <ShopSurveySkeleton />
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="max-[600px] relative flex flex-col gap-10 p-2"
      >

        <StepsManager
          currentStep={currentStep}
          onNextStep={handleNext}
          onPrevStep={handlePrev}
        />
      </form>
    </Form>
  )
}
