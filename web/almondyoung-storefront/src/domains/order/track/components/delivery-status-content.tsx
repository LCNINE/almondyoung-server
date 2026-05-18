"use client"

import { useTranslations } from "next-intl"
import React from "react"

interface DeliveryStatusContentProps {
  title: string
  description?: string
}

export function DeliveryStatusContent({
  title,
  description,
}: DeliveryStatusContentProps) {
  return (
    <>
      <p className="w-full flex-shrink-0 flex-grow-0 self-stretch text-center text-2xl font-bold text-white">
        {title}
      </p>
      {description && (
        <p className="flex-shrink-0 flex-grow-0 text-center text-lg text-white">
          {description}
        </p>
      )}
    </>
  )
}

export function DeliveryCompletedContent({ date }: { date: string }) {
  const t = useTranslations("mypage.order.delivery")
  return (
    <DeliveryStatusContent
      title={t("deliveredTitle", { date })}
      description={t("deliveredDescription")}
    />
  )
}

export function PreparingOrderContent() {
  const t = useTranslations("mypage.order.delivery")
  return <DeliveryStatusContent title={t("preparingTitle")} />
}

export function ShippingStartedContent() {
  const t = useTranslations("mypage.order.delivery")
  return (
    <DeliveryStatusContent
      title={t("shippingStartedTitle")}
      description={t("shippingStartedDescription")}
    />
  )
}

export function InTransitContent() {
  const t = useTranslations("mypage.order.delivery")
  return (
    <DeliveryStatusContent
      title={t("shippingTitle")}
      description={t("shippingDescription")}
    />
  )
}

interface DynamicDeliveryContentProps {
  currentStep: number
  completedDate?: string
}

export function DynamicDeliveryContent({
  currentStep,
  completedDate,
}: DynamicDeliveryContentProps) {
  const t = useTranslations("mypage.order.delivery")

  switch (currentStep) {
    case 1:
      return <DeliveryStatusContent title={t("paidTitle")} />
    case 2:
      return <PreparingOrderContent />
    case 3:
      return <ShippingStartedContent />
    case 4:
      return <InTransitContent />
    case 5:
      return completedDate ? (
        <DeliveryCompletedContent date={completedDate} />
      ) : (
        <DeliveryStatusContent
          title={t("delivered")}
          description={t("deliveredDescription")}
        />
      )
    default:
      return (
        <DeliveryStatusContent
          title={t("processingTitle")}
          description={t("processingDescription")}
        />
      )
  }
}
