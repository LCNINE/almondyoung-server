"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"
import { cn } from "@lib/utils"
// shadcn/ui 컴포넌트를 임포트합니다. (경로는 실제 위치에 맞게 수정)
import {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
} from "@components/common/ui/drawer"

type DrawerDirection = "top" | "bottom" | "left" | "right"

// --- 1. 방향(direction)을 지원하는 커스텀 DrawerContent ---
// (기존과 동일: Vaul의 Content를 확장하여 방향 클래스를 적용)

const directionClasses: Record<DrawerDirection, string> = {
  bottom:
    "fixed inset-x-0 bottom-0 z-50 mt-24 flex h-auto flex-col rounded-t-[10px] border bg-background",
  top: "fixed inset-x-0 top-0 z-50 mb-24 flex h-auto flex-col rounded-b-[10px] border bg-background",
  left: "fixed inset-y-0 left-0 z-50 flex h-full w-3/4 flex-col border-r bg-background sm:max-w-sm",
  right:
    "fixed inset-y-0 right-0 z-50 flex h-full w-3/4 flex-col border-l bg-background sm:max-w-sm",
}

interface OverlayDrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> {
  direction?: DrawerDirection
}

const OverlayDrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  OverlayDrawerContentProps
>(({ className, children, direction = "bottom", ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DrawerPrimitive.Content
      ref={ref}
      className={cn(
        directionClasses[direction], // 방향에 따른 동적 클래스 적용
        className
      )}
      {...props}
    >
      {/* 'bottom' 방향일 때만 상단 드래그 핸들 표시 */}
      {direction === "bottom" && (
        <div className="bg-muted mx-auto mt-4 h-2 w-[100px] rounded-full" />
      )}
      {children}
    </DrawerPrimitive.Content>
  </DrawerPortal>
))
OverlayDrawerContent.displayName = "OverlayDrawerContent"

// --- 2. [신규] OverlayDrawer "브릿지" 컴포넌트 ---
// (이전의 OverlayDrawerInternal과 useOverlayDrawer 훅을 대체)

interface OverlayDrawerProps {
  /**
   * `useOverlay` 훅에서 전달되는 `isOpen` 상태
   */
  isOpen: boolean
  /**
   * `useOverlay` 훅에서 전달되는 `close` 함수
   */
  close: () => void
  /**
   * `useOverlay` 훅에서 전달되는 `exit` 함수
   */
  exit: () => void
  /**
   * Drawer 내부에 표시될 자식 요소
   */
  children: React.ReactNode
  /**
   * 애니메이션 방향 (기본: "bottom")
   */
  direction?: DrawerDirection
  /**
   * DrawerContent에 적용할 추가 Tailwind 클래스
   */
  className?: string
}

/**
 * @toss/use-overlay 훅과 shadcn/ui(vaul) Drawer를 연결하는
 * 재사용 가능한 프레젠테이션 컴포넌트입니다.
 *
 * `useOverlay`의 `isOpen`, `close`, `exit`를 props로 받아
 * `vaul`의 애니메이션 생명주기에 맞춰 상태를 동기화합니다.
 */
export function OverlayDrawer({
  isOpen,
  close,
  exit,
  children,
  direction = "bottom",
  className,
}: OverlayDrawerProps) {
  const handleClose = () => {
    close() // 1. useOverlay의 close() 호출 -> isOpen이 false가 됨
  }

  const handleTransitionEnd = (e: React.TransitionEvent) => {
    // 3. Vaul의 transform 애니메이션(슬라이드)이 끝나고,
    //    컴포넌트가 닫히는 상태(isOpen=false)일 때 exit()를 호출하여 unmount
    if (e.propertyName === "transform" && !isOpen) {
      exit()
    }
  }

  return (
    // shadcn/ui의 <Drawer> (Vaul의 Root)를 사용
    <Drawer
      open={isOpen} // 2. isOpen이 false가 되면 Vaul이 닫힘 애니메이션 시작
      onOpenChange={(open: boolean) => {
        // 유저가 오버레이를 클릭하거나 스와이프해서 닫을 때
        if (!open) {
          handleClose()
        }
      }}
      direction={direction} // Vaul에 애니메이션 방향 전달
    >
      {/* 3. 애니메이션 종료를 감지하기 위해 onTransitionEnd 추가 */}
      <OverlayDrawerContent
        direction={direction}
        onTransitionEnd={handleTransitionEnd}
        className={className} // 컨텐츠에 커스텀 클래스 전달
      >
        {children}
      </OverlayDrawerContent>
    </Drawer>
  )
}
