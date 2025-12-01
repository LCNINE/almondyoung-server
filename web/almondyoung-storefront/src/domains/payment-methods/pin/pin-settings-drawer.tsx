"use client"

import { useState, useEffect } from "react"
import { X } from "lucide-react"
import { Drawer } from "vaul"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@components/common/ui/dialog"
import { useMediaQuery } from "hooks/use-media-query"
import { toast } from "sonner"
import { SecurityKeypad } from "./security-keypad"
import { LoginPasswordModal } from "./login-password-modal"
import {
  getPinStatus,
  registerPin,
  verifyPin,
  resetPin,
  verifyPasswordForPinReset,
  type PinStatus,
  type PinErrorResponse,
} from "@lib/api/wallet"

interface PinSettingsDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Step =
  | "loading"
  | "register-first" // 최초 등록: 1차 입력
  | "register-confirm" // 최초 등록: 2차 확인
  | "reset-verify-password" // 재설정: 본인확인
  | "reset-new-pin" // 재설정: 새 비밀번호 입력
  | "reset-confirm" // 재설정: 새 비밀번호 확인

/**
 * 결제 비밀번호 설정 Drawer
 * 시나리오 B (최초 등록) 및 시나리오 D (재설정)를 처리합니다.
 */
export function PinSettingsDrawer({
  open,
  onOpenChange,
}: PinSettingsDrawerProps) {
  const isDesktop = useMediaQuery("(min-width: 768px)")
  const [step, setStep] = useState<Step>("loading")
  const [pinStatus, setPinStatus] = useState<PinStatus | null>(null)
  const [firstPin, setFirstPin] = useState<string>("")
  const [verificationToken, setVerificationToken] = useState<string>("")
  const [errorMessage, setErrorMessage] = useState<string>("")
  const [failureCount, setFailureCount] = useState<number>(0)
  const [maxFailureCount, setMaxFailureCount] = useState<number>(5)
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false)

  // Drawer가 열릴 때 PIN 상태 조회
  useEffect(() => {
    if (open) {
      loadPinStatus()
    } else {
      // 닫힐 때 상태 초기화
      resetState()
    }
  }, [open])

  // PIN 상태 조회
  const loadPinStatus = async () => {
    try {
      setStep("loading")
      const status = await getPinStatus()
      setPinStatus(status)

      if (!status.hasPin) {
        // PIN이 없으면 최초 등록 플로우
        setStep("register-first")
      } else if (status.status === "LOCKED") {
        // 잠금 상태면 재설정 플로우
        setStep("reset-verify-password")
        setIsLoginModalOpen(true)
      } else {
        // PIN이 있으면 재설정 플로우 (자발적)
        setStep("reset-verify-password")
        setIsLoginModalOpen(true)
      }
    } catch (error) {
      console.error("Failed to load PIN status:", error)
      toast.error("PIN 상태를 불러오는데 실패했습니다.")
      onOpenChange(false)
    }
  }

  // 상태 초기화
  const resetState = () => {
    setStep("loading")
    setFirstPin("")
    setVerificationToken("")
    setErrorMessage("")
    setFailureCount(0)
    setMaxFailureCount(5)
    setIsLoginModalOpen(false)
  }

  // ==========================================
  // 시나리오 B: 최초 등록
  // ==========================================

  // 1차 입력 완료
  const handleFirstPinComplete = (pin: string) => {
    setFirstPin(pin)
    setErrorMessage("")
    setStep("register-confirm")
  }

  // 2차 확인 완료
  const handleConfirmPinComplete = async (pin: string) => {
    if (pin !== firstPin) {
      setErrorMessage("비밀번호가 일치하지 않습니다")
      setFirstPin("")
      setStep("register-first")
      return
    }

    try {
      setErrorMessage("")
      await registerPin(pin)
      toast.success("결제 비밀번호가 등록되었습니다.")
      onOpenChange(false)
    } catch (error: any) {
      const errorData = error as PinErrorResponse
      if (errorData.code === "WEAK_PIN") {
        toast.error("연속되거나 반복된 숫자는 사용할 수 없습니다.")
        setFirstPin("")
        setStep("register-first")
      } else {
        toast.error(errorData.message || "PIN 등록에 실패했습니다.")
        setFirstPin("")
        setStep("register-first")
      }
    }
  }

  // ==========================================
  // 시나리오 D: 재설정
  // ==========================================

  // 본인확인 완료
  const handlePasswordVerifyComplete = async (password: string) => {
    try {
      setIsLoginModalOpen(false)
      const response = await verifyPasswordForPinReset(password)
      setVerificationToken(response.verificationToken)
      setStep("reset-new-pin")
    } catch (error: any) {
      toast.error(error.message || "비밀번호가 올바르지 않습니다.")
    }
  }

  // 새 비밀번호 입력 완료
  const handleNewPinComplete = (pin: string) => {
    setFirstPin(pin)
    setErrorMessage("")
    setStep("reset-confirm")
  }

  // 새 비밀번호 확인 완료
  const handleResetConfirmComplete = async (pin: string) => {
    if (pin !== firstPin) {
      setErrorMessage("비밀번호가 일치하지 않습니다")
      setFirstPin("")
      setStep("reset-new-pin")
      return
    }

    try {
      setErrorMessage("")
      await resetPin(pin, verificationToken)
      toast.success("비밀번호가 재설정되었습니다.")
      onOpenChange(false)
    } catch (error: any) {
      const errorData = error as PinErrorResponse
      if (errorData.code === "WEAK_PIN") {
        toast.error("연속되거나 반복된 숫자는 사용할 수 없습니다.")
        setFirstPin("")
        setStep("reset-new-pin")
      } else if (errorData.code === "INVALID_TOKEN") {
        toast.error("인증 시간이 만료되었습니다. 다시 시도해주세요.")
        setStep("reset-verify-password")
        setIsLoginModalOpen(true)
      } else {
        toast.error(errorData.message || "PIN 재설정에 실패했습니다.")
        setFirstPin("")
        setStep("reset-new-pin")
      }
    }
  }

  // 취소
  const handleCancel = () => {
    onOpenChange(false)
  }

  // ==========================================
  // 렌더링
  // ==========================================

  const renderContent = () => {
    switch (step) {
      case "loading":
        return (
          <div className="flex h-64 items-center justify-center">
            <p className="text-gray-600">로딩 중...</p>
          </div>
        )

      case "register-first":
        return (
          <SecurityKeypad
            title="결제에 사용할 비밀번호 6자리를 설정해주세요."
            onComplete={handleFirstPinComplete}
            onCancel={handleCancel}
            errorMessage={errorMessage}
          />
        )

      case "register-confirm":
        return (
          <SecurityKeypad
            title="한 번 더 입력해주세요."
            onComplete={handleConfirmPinComplete}
            onCancel={handleCancel}
            errorMessage={errorMessage}
          />
        )

      case "reset-new-pin":
        return (
          <SecurityKeypad
            title="새로운 결제 비밀번호를 입력해주세요."
            onComplete={handleNewPinComplete}
            onCancel={handleCancel}
            errorMessage={errorMessage}
          />
        )

      case "reset-confirm":
        return (
          <SecurityKeypad
            title="한 번 더 입력해주세요."
            onComplete={handleResetConfirmComplete}
            onCancel={handleCancel}
            errorMessage={errorMessage}
          />
        )

      default:
        return null
    }
  }

  const content = (
    <>
      {/* Mobile Drag Handle */}
      {!isDesktop && (
        <div className="mx-auto mt-4 mb-2 h-1.5 w-12 shrink-0 rounded-full bg-gray-300" />
      )}

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto bg-white">{renderContent()}</div>
    </>
  )

  return (
    <>
      {/* 본인확인 모달 */}
      <LoginPasswordModal
        open={isLoginModalOpen}
        onOpenChange={setIsLoginModalOpen}
        onComplete={handlePasswordVerifyComplete}
        onCancel={() => {
          setIsLoginModalOpen(false)
          onOpenChange(false)
        }}
      />

      {/* Drawer/Dialog */}
      {isDesktop ? (
        <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent
            className="flex max-h-[90vh] max-w-[500px] flex-col gap-0 overflow-hidden p-0"
            showCloseButton={false}
          >
            <button
              onClick={() => onOpenChange(false)}
              className="absolute top-4 right-4 z-50 rounded-full bg-white/80 p-1 hover:bg-gray-100"
              aria-label="닫기"
            >
              <X className="h-5 w-5" />
            </button>
            <DialogTitle className="sr-only">결제 비밀번호 설정</DialogTitle>
            <DialogDescription className="sr-only">
              결제 비밀번호를 등록하거나 재설정합니다.
            </DialogDescription>
            {content}
          </DialogContent>
        </Dialog>
      ) : (
        <Drawer.Root open={open} onOpenChange={onOpenChange}>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
            <Drawer.Content className="fixed right-0 bottom-0 left-0 z-50 flex h-[96vh] flex-col rounded-t-[10px] bg-white">
              {content}
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      )}
    </>
  )
}

