"use client"

import { X } from "lucide-react"
import { Drawer } from "vaul"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@components/common/ui/dialog"
import { useMediaQuery } from "hooks/use-media-query"
import { useEffect, useState } from "react"
import AddPaymentMethodSelector from "./add-payment-method-selector"
import AddBankForm from "./add-bank-form"

interface PaymentMethodAddDrawerProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

type Step = "selector" | "bank"

export function PaymentMethodAddDrawer({
    open,
    onOpenChange,
}: PaymentMethodAddDrawerProps) {
    const isDesktop = useMediaQuery("(min-width: 768px)")
    const [step, setStep] = useState<Step>("selector")

    // Reset step when closed
    useEffect(() => {
        if (!open) {
            // Wait for animation to finish before resetting
            const timer = setTimeout(() => setStep("selector"), 300)
            return () => clearTimeout(timer)
        }
    }, [open])

    // Browser back button handling
    useEffect(() => {
        if (!open) return

        const handlePopState = () => {
            if (step !== "selector") {
                setStep("selector")
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
        } else {
            setStep("selector")
        }
    }

    const handleComplete = () => {
        onOpenChange(false)
        // Ideally trigger a refresh of the list here if needed, 
        // but the forms currently handle router.refresh() or we can pass a callback
    }

    const renderContent = () => {
        switch (step) {
            case "bank":
                return <AddBankForm onBack={handleBack} onComplete={handleComplete} />
            case "selector":
            default:
                return <AddPaymentMethodSelector onSelect={(type) => {
                    // 카드는 멤버십 카드 등록으로 분리되었으므로 bank만 처리
                    if (type === "bank") {
                        setStep("bank")
                    }
                }} />
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
                <div className="mx-auto mt-4 h-1.5 w-12 shrink-0 rounded-full bg-gray-300 mb-2" />
            )}

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto bg-white">
                {renderContent()}
            </div>
        </>
    )

    if (isDesktop) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent
                    className="flex max-h-[90vh] max-w-[500px] flex-col gap-0 p-0 overflow-hidden"
                    showCloseButton={false}
                >
                    {/* Desktop Close Button (Absolute) */}
                    <button
                        onClick={() => onOpenChange(false)}
                        className="absolute right-4 top-4 z-50 rounded-full bg-white/80 p-1 hover:bg-gray-100"
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
