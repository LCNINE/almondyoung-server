"use client"

import { X } from "lucide-react"
import { Drawer } from "vaul"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@components/common/ui/dialog"
import { useMediaQuery } from "hooks/use-media-query"
import { useEffect, useState } from "react"
import AddCardForm from "./add-card-form"

interface MembershipCardAddDrawerProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export function MembershipCardAddDrawer({
    open,
    onOpenChange,
}: MembershipCardAddDrawerProps) {
    const isDesktop = useMediaQuery("(min-width: 768px)")

    const handleComplete = () => {
        onOpenChange(false)
    }

    const handleBack = () => {
        onOpenChange(false)
    }

    const content = (
        <>
            {/* Mobile Drag Handle (Drawer only) */}
            {!isDesktop && (
                <div className="mx-auto mt-4 h-1.5 w-12 shrink-0 rounded-full bg-gray-300 mb-2" />
            )}

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto bg-white">
                <AddCardForm onBack={handleBack} onComplete={handleComplete} />
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
                    <DialogTitle className="sr-only">멤버십 카드 등록</DialogTitle>
                    <DialogDescription className="sr-only">
                        멤버십 회비 결제를 위한 HMS 카드를 등록합니다.
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

