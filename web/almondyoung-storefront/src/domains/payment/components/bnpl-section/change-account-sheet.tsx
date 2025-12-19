"use client"

import { Button } from "@components/common/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@components/common/ui/sheet"
import { deletePaymentProfile, setDefaultPaymentProfile } from "@lib/api/wallet"
import type { BnplProfileDto } from "@lib/types/dto/wallet"
import { Check, CreditCard, Loader2, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useTransition } from "react"
import { toast } from "sonner"
import { usePaymentMethodModalStore } from "../store/payment-method-modal-store"
import { maskAccountNumber } from "../utils"
import { Spinner } from "@components/common/spinner"

interface ChangeAccountSheetProps {
  isOpen: boolean
  onClose: () => void
  bnplProfiles: BnplProfileDto[]
}

// 계좌 변경 시트 컴포넌트
export default function ChangeAccountSheet({
  isOpen,
  onClose,
  bnplProfiles,
}: ChangeAccountSheetProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { openModal: openPaymentMethodModal } = usePaymentMethodModalStore() // 결제 수단 선택 모달

  useEffect(() => {
    // 나중결제 계좌가 1개이고, 기본 결제 수단이 설정되지 않은 경우에만 설정
    if (bnplProfiles.length === 1 && !bnplProfiles[0].isDefault) {
      console.log("기본 결제 수단 자동 설정:", bnplProfiles[0])
      startTransition(async () => {
        try {
          await setDefaultPaymentProfile(bnplProfiles[0].id)
          router.refresh()
        } catch (error) {
          console.error("기본 결제 수단 설정에 실패했습니다.", error)
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bnplProfiles.length,
    bnplProfiles[0]?.id,
    bnplProfiles[0]?.isDefault,
    router,
  ])

  const handleSelectAccount = async (profileId: string) => {
    try {
      if (confirm("기본 출금 계좌를 변경하시겠습니까?")) {
        await setDefaultPaymentProfile(profileId)
        toast.success("기본 출금 계좌가 변경되었습니다")
        router.refresh()
      }
    } catch (error) {
      toast.error("계좌 변경에 실패했습니다")
    }
  }

  if (!isOpen) return null

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        side="bottom"
        className="m-auto flex h-2/4 max-w-3xl flex-col"
      >
        <SheetHeader>
          <SheetTitle>계좌 변경</SheetTitle>
          <SheetDescription>변경할 출금 계좌를 선택해주세요</SheetDescription>
        </SheetHeader>

        <p className="text-sm font-medium">
          등록 계좌 <span className="font-bold">{bnplProfiles.length}개</span>
        </p>

        {isPending ? (
          <div className="flex flex-1 items-center justify-center">
            <Spinner size="sm" color="white" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pb-4">
            <BankAccountList
              bnplProfiles={bnplProfiles}
              onSelectAccount={handleSelectAccount}
            />
          </div>
        )}

        <SheetFooter className="mt-4">
          <Button
            variant="default"
            className="w-full cursor-pointer"
            onClick={openPaymentMethodModal}
          >
            + {bnplProfiles.length === 0 ? "결제수단 등록" : "결제수단 추가"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function BankAccountList({
  bnplProfiles,
  onSelectAccount,
}: {
  bnplProfiles: BnplProfileDto[]
  onSelectAccount: (profileId: string) => void
}) {
  // isDefault가 true인 항목을 맨 위로 정렬
  const sortedProfiles = [...bnplProfiles].sort((a, b) => {
    if (a.isDefault) return -1
    if (b.isDefault) return 1
    return 0
  })

  return (
    <div>
      <ul className="mt-4 space-y-3 px-1">
        {sortedProfiles.map((paymentProfile, index) => (
          <BankAccountItem
            key={paymentProfile.id}
            paymentProfile={paymentProfile}
            onSelectAccount={onSelectAccount}
            style={{ animationDelay: `${index * 50}ms` }}
          />
        ))}
      </ul>
    </div>
  )
}

function BankAccountItem({
  paymentProfile,
  style,
  onSelectAccount,
}: {
  paymentProfile: BnplProfileDto
  style?: React.CSSProperties
  onSelectAccount: (profileId: string) => void
}) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()

    startTransition(async () => {
      try {
        if (confirm("계좌를 삭제하시겠습니까?")) {
          await deletePaymentProfile(paymentProfile.id)
          router.refresh()
          toast.success("계좌가 삭제되었습니다.")
        }
      } catch (error) {
        console.error("Failed to delete payment profile:", error)
        toast.error("계좌 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.")
      }
    })
  }

  if (paymentProfile.isDefault) {
    return (
      <li
        className="animate-fade-in bg-card-default card-default-glow card-hover border-border overflow-hidden rounded-xl border"
        style={style}
      >
        {/* Default badge - integrated top bar */}
        <div className="bg-primary flex items-center gap-2 px-4 py-2">
          <div className="bg-primary-foreground/20 flex items-center justify-center rounded-full p-1">
            <Check className="text-primary-foreground size-3" strokeWidth={3} />
          </div>
          <span className="text-primary-foreground text-xs font-semibold">
            기본 결제수단
          </span>
        </div>

        {/* Card content */}
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            {/* Icon */}
            <div className="bg-primary flex size-12 items-center justify-center rounded-xl shadow-sm">
              <CreditCard className="text-primary-foreground size-6" />
            </div>

            {/* Info */}
            <div>
              <p className="text-foreground font-semibold">
                {paymentProfile.name}
              </p>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {maskAccountNumber(paymentProfile.details?.paymentNumber || "")}
              </p>
            </div>
          </div>

          {/* Delete button */}
          <Button
            type="button"
            onClick={handleDelete}
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive cursor-pointer hover:bg-transparent"
            disabled={isPending}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </li>
    )
  }

  return (
    <li
      className="animate-fade-in border-border bg-card card-hover overflow-hidden rounded-xl border"
      style={style}
      onClick={() => onSelectAccount(paymentProfile.id)}
    >
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-4">
          {/* Icon */}
          <div className="bg-secondary flex size-12 items-center justify-center rounded-xl">
            <CreditCard className="text-muted-foreground size-6" />
          </div>

          {/* Info */}
          <div>
            <p className="text-foreground font-medium">{paymentProfile.name}</p>
            <p className="text-muted-foreground mt-0.5 text-sm">
              {maskAccountNumber(paymentProfile.details?.paymentNumber || "")}
            </p>
          </div>
        </div>

        {/* Delete button */}
        <Button
          type="button"
          onClick={handleDelete}
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive cursor-pointer hover:bg-transparent"
          disabled={isPending}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  )
}
