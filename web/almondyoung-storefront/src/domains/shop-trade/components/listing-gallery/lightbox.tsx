"use client"

import { useEffect, useRef } from "react"
import Image from "next/image"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { getThumbnailUrl } from "@/lib/utils/get-thumbnail-url"

/** 이보다 적게 움직이면 사진을 넘기지 않는다 (탭으로 닫으려던 손짓과 구분) */
const SWIPE_THRESHOLD = 50

interface Props {
  images: string[]
  /** 열려 있는 사진의 인덱스. null 이면 닫힘 */
  index: number | null
  onIndexChange: (index: number) => void
  onClose: () => void
  alt: string
}

/** 슬라이드는 4:3 으로 잘려 보이므로, 사진 전체를 보고 싶을 때 여는 확대 화면 */
export function GalleryLightbox({
  images,
  index,
  onIndexChange,
  onClose,
  alt,
}: Props) {
  const open = index !== null
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!open || index === null) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        onIndexChange((index - 1 + images.length) % images.length)
      }
      if (e.key === "ArrowRight") {
        onIndexChange((index + 1) % images.length)
      }
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, index, images.length, onIndexChange])

  if (index === null) return null

  const move = (step: number) =>
    onIndexChange((index + step + images.length) % images.length)

  // 모바일에서 사진을 넘기는 유일한 수단 — 작은 화살표를 정확히 누르게 두면 안 된다.
  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current
    touchStart.current = null
    if (!start || images.length < 2) return

    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y

    // 세로로 더 많이 움직였으면 넘기기 의도가 아니다
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return
    move(dx < 0 ? 1 : -1)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPortal>
        <DialogOverlay className="bg-black/90" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center focus:outline-none"
          // 사진만 보는 화면이라 기본 애니메이션·여백 없이 전체를 쓴다
          onClick={onClose}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <DialogTitle className="sr-only">{alt} 사진 크게 보기</DialogTitle>

          <div className="relative h-full w-full">
            <Image
              src={getThumbnailUrl(images[index])}
              alt={`${alt} 사진 ${index + 1}`}
              fill
              sizes="100vw"
              className="object-contain"
              priority
            />
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
          >
            <X className="h-5 w-5" />
          </button>

          {images.length > 1 && (
            <>
              <button
                type="button"
                aria-label="이전 사진"
                onClick={(e) => {
                  e.stopPropagation()
                  move(-1)
                }}
                className="absolute left-3 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                aria-label="다음 사진"
                onClick={(e) => {
                  e.stopPropagation()
                  move(1)
                }}
                className="absolute right-3 rounded-full bg-black/50 p-2 text-white transition-colors hover:bg-black/70"
              >
                <ChevronRight className="h-6 w-6" />
              </button>

              <span className="absolute bottom-5 rounded-full bg-black/50 px-3 py-1 text-sm text-white">
                {index + 1} / {images.length}
              </span>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
