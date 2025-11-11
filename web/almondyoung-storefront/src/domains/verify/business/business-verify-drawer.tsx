"use client"
import { ArrowLeft, X } from "lucide-react"
import { Drawer } from "vaul"
import { Dialog, DialogContent } from "@components/common/ui/dialog"
import { useMediaQuery } from "hooks/use-media-query"
import { useEffect } from "react"
import BusinessVerifyForm from "./index"

interface BusinessVerifyDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onBack?: () => void
  onComplete?: () => void
}

export function BusinessVerifyDrawer({
  open,
  onOpenChange,
  onBack,
  onComplete,
}: BusinessVerifyDrawerProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)")

  const handleClose = () => {
    if (onBack) {
      onBack()
    } else {
      onOpenChange(false)
    }
  }

  // 브라우저 뒤로가기 처리
  useEffect(() => {
    if (!open) return

    const handlePopState = () => {
      handleClose()
    }

    // 모달이 열릴 때 히스토리 추가
    window.history.pushState({ modal: "business" }, "")
    window.addEventListener("popstate", handlePopState)

    return () => {
      window.removeEventListener("popstate", handlePopState)
    }
  }, [open])

  const content = (
    <>
      {/* 헤더 */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="rounded-full p-1 hover:bg-gray-100"
              aria-label="뒤로가기"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <h2 className="text-lg font-bold">사업자 확인</h2>
        </div>
        <button
          onClick={() => onOpenChange(false)}
          className="rounded-full p-1 hover:bg-gray-100"
          aria-label="닫기"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* 스크롤 가능한 컨텐츠 */}
      <div className="flex-1 overflow-y-auto">
        <BusinessVerifyForm onComplete={onComplete} />
      </div>
    </>
  )

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="flex max-h-[90vh] max-w-[500px] flex-col gap-0 p-0"
          showCloseButton={false}
        >
          {content}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Drawer.Content className="fixed right-0 bottom-0 left-0 z-50 flex max-h-[96vh] flex-col rounded-t-[10px] bg-white">
          {/* 모바일 드래그 핸들 */}
          <div className="mx-auto mt-4 h-1.5 w-12 flex-shrink-0 rounded-full bg-gray-300" />
          {content}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
