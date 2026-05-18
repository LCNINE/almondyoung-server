"use client"

import { useTranslations } from "next-intl"
import { CustomButton } from "@/components/shared/custom-buttons/custom-button"

import type { OrderStatus } from "@components/orders/types"

interface OrderActionButtonsProps {
  type: OrderStatus
}

function ActionButtonsList({ type }: OrderActionButtonsProps) {
  const t = useTranslations("mypage.orderActions")
  const handleTrackingClick = () => console.log("track delivery")
  const handleCancelClick = () => console.log("cancel order")
  const handleExchangeClick = () => console.log("exchange/return")
  const handleInquiryClick = () => console.log("inquiry")

  const commonButtonProps = {
    className: "flex-1 md:flex-none md:w-full",
  }

  if (type === "preparing") {
    return (
      <>
        <CustomButton
          variant="outline"
          size="lg"
          onClick={handleTrackingClick}
          {...commonButtonProps}
        >
          {t("trackDelivery")}
        </CustomButton>
        <CustomButton
          variant="secondary"
          size="lg"
          onClick={handleCancelClick}
          {...commonButtonProps}
        >
          {t("cancelOrder")}
        </CustomButton>
        <CustomButton
          variant="secondary"
          size="lg"
          onClick={handleInquiryClick}
          {...commonButtonProps}
        >
          {t("inquiry")}
        </CustomButton>
      </>
    )
  }

  if (type === "completed") {
    return (
      <>
        <CustomButton
          variant="outline"
          size="lg"
          onClick={handleTrackingClick}
          {...commonButtonProps}
        >
          {t("trackDelivery")}
        </CustomButton>
        <CustomButton
          variant="secondary"
          size="lg"
          onClick={handleExchangeClick}
          {...commonButtonProps}
        >
          {t("requestExchangeReturn")}
        </CustomButton>
      </>
    )
  }

  if (type === "cancelled") {
    return (
      <CustomButton
        variant="ghost"
        color="secondary"
        size="lg"
        onClick={handleInquiryClick}
        {...commonButtonProps}
      >
        {t("inquiry")}
      </CustomButton>
    )
  }

  return (
    <>
      <CustomButton
        variant="outline"
        size="lg"
        onClick={handleTrackingClick}
        {...commonButtonProps}
      >
        {t("trackDelivery")}
      </CustomButton>
      <CustomButton
        variant="secondary"
        size="lg"
        onClick={handleExchangeClick}
        {...commonButtonProps}
      >
        {t("requestExchangeReturn")}
      </CustomButton>
      <CustomButton
        variant="secondary"
        size="lg"
        onClick={handleInquiryClick}
        {...commonButtonProps}
      >
        {t("inquiry")}
      </CustomButton>
    </>
  )
}

export function OrderActionButtons({ type }: OrderActionButtonsProps) {
  return (
    <div className="flex flex-1 gap-2 md:flex-col">
      <ActionButtonsList type={type} />
    </div>
  )
}
