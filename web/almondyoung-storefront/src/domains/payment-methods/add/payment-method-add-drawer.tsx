"use client"

import { X } from "lucide-react"
import { Drawer } from "vaul"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@components/common/ui/dialog"
import { useMediaQuery } from "hooks/use-media-query"
import { useEffect, useState } from "react"
import AddPaymentMethodSelector from "./add-payment-method-selector"
import AddBankForm, { BankFormData } from "./add-bank-form"
import PhoneVerifyForm, { PhoneFormData } from "domains/verify/phone/index"
import LaterPaymentRegularConfirm from "./later-payment-regular-confirm"

interface PaymentMethodAddDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Step = "selector" | "bank" | "phone" | "confirm"

export function PaymentMethodAddDrawer({
  open,
  onOpenChange,
}: PaymentMethodAddDrawerProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)")
  const [step, setStep] = useState<Step>("selector")
  const [bankData, setBankData] = useState<BankFormData | null>(null)
  const [phoneData, setPhoneData] = useState<PhoneFormData | null>(null)

  // Reset step when closed
  useEffect(() => {
    if (!open) {
      // Wait for animation to finish before resetting
      const timer = setTimeout(() => {
        setStep("selector")
        setBankData(null)
        setPhoneData(null)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [open])

  // Browser back button handling
  useEffect(() => {
    if (!open) return

    const handlePopState = () => {
      if (step !== "selector") {
        if (step === "confirm") {
          setStep("phone")
        } else if (step === "phone") {
          setStep("bank")
        } else if (step === "bank") {
          setStep("selector")
        }
        // Push state again because we just popped it, but we're still in the modal
        window.history.pushState({ modal: "payment-add" }, "")
      } else {
        onOpenChange(false)
      }
    }

    window.history.pushState({ modal: "payment-add" }, "")
    window.addEventListener("popstate", handlePopState)

    return () => {
      window.removeEventListener("popstate", handlePopState)
    }
  }, [open, onOpenChange, step])

  const handleBack = () => {
    if (step === "selector") {
      onOpenChange(false)
    } else if (step === "bank") {
      setStep("selector")
    } else if (step === "phone") {
      setStep("bank")
    } else if (step === "confirm") {
      setStep("phone")
    }
  }

  const handleBankComplete = (data: BankFormData) => {
    setBankData(data)
    setStep("phone")
  }

  const handlePhoneComplete = (data: PhoneFormData) => {
    setPhoneData(data)
    setStep("confirm")
  }

  const handleConfirmComplete = () => {
    onOpenChange(false)
    // Ideally trigger a refresh of the list here if needed
  }

  const renderContent = () => {
    switch (step) {
      case "bank":
        return (
          <AddBankForm
            onBack={handleBack}
            onComplete={handleBankComplete}
            initialData={bankData}
          />
        )
      case "phone":
        return (
          <PhoneVerifyForm
            onComplete={handlePhoneComplete}
            onBack={handleBack}
            initialData={phoneData}
          />
        )
      case "confirm":
        return (
          <LaterPaymentRegularConfirm
            onBack={handleBack}
            onComplete={handleConfirmComplete}
            bankData={bankData}
            phoneData={phoneData}
          />
        )
      case "selector":
      default:
        return (
          <AddPaymentMethodSelector
            onSelect={(type) => {
              // 카드는 멤버십 카드 등록으로 분리되었으므로 bank만 처리
              if (type === "bank") {
                setStep("bank")
              }
            }}
          />
        )
    }
  }

  const content = (
    <>
      {/* Header - Only show close button if we are in selector mode or on desktop where we might want a consistent header? 
          Actually, the sub-components (forms) might have their own headers. 
          Let's check the design. The selector has a header. The forms have headers.
          We should probably hide the drawer header if the components have their own, 
          OR refactor the components to NOT have headers and put a common one here.
          
          Looking at existing code:
          - AddPaymentMethodSelector has a header with back button.
          - AddBankForm has an h1 "계좌 등록".
          - AddCardForm has an h1 "HMS 카드 등록".
          
          For a clean modal, we usually want a common header wrapper.
          However, to minimize refactoring risk, let's wrap them simply.
          But wait, the drawer in `phone-verify-drawer` has a header.
          
          Let's use a simple container for now and let the components render their content.
          We might need to adjust padding.
      */}

      {/* Mobile Drag Handle (Drawer only) */}
      {!isDesktop && (
        <div className="mx-auto mt-4 mb-2 h-1.5 w-12 shrink-0 rounded-full bg-gray-300" />
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto bg-white">{renderContent()}</div>
    </>
  )

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex max-h-[90vh] max-w-[500px] flex-col gap-0 overflow-hidden p-0"
          showCloseButton={false}
        >
          {/* Desktop Close Button (Absolute) */}
          <button
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 z-50 rounded-full bg-white/80 p-1 hover:bg-gray-100"
            aria-label="닫기"
          >
            <X className="h-5 w-5" />
          </button>
          <DialogTitle className="sr-only">결제 수단 등록</DialogTitle>
          <DialogDescription className="sr-only">
            새로운 결제 수단을 선택하고 등록합니다.
          </DialogDescription>
          {content}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content className="fixed right-0 bottom-0 left-0 z-50 flex h-[96vh] flex-col rounded-t-[10px] bg-white">
          {content}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
