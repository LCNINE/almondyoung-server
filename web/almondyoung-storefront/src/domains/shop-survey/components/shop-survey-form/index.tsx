"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { Form } from "@/components/ui/form"

import { useShopSurvey } from "@/domains/shop-survey/hooks/use-shop-survey"
import {
  ShopSurveySchema,
  shopSurveySchema,
} from "@/domains/shop-survey/schemas/suvery-schema"
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
  const { modifyShopSurveyAction, isLoading, getShopSurveyAction } =
    useShopSurvey()

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
    try {
      await modifyShopSurveyAction(data)
      toast.success("정보가 저장되었습니다.")
      router.push(redirectTo ?? "/")
    } catch (error) {
      toast.error("정보 저장에 실패했습니다. 잠시 후 다시 시도해주세요.")
    }
  }

  useEffect(() => {
    const getShopSurveyData = async () => {
      const res = await getShopSurveyAction()
      form.reset(res) // todo: 해결해야함 ..
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
