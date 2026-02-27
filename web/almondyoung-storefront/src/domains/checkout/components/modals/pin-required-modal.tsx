"use client"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { useParams, useRouter } from "next/navigation"

interface PinRequiredModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function PinRequiredModal({ open, onOpenChange }: PinRequiredModalProps) {
  const router = useRouter()
  const params = useParams()
  const countryCode = params.countryCode as string

  const handleConfirm = () => {
    router.push(
      `/${countryCode}/mypage/payment/security?redirect_to=/checkout`
    )
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>결제 비밀번호 등록 필요</AlertDialogTitle>
          <AlertDialogDescription>
            결제를 진행하려면 결제 비밀번호(PIN) 등록이 필요합니다.
            <br />
            등록 페이지로 이동하시겠습니까?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-[#F29219] hover:bg-[#F29219]/90"
          >
            등록하러 가기
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
