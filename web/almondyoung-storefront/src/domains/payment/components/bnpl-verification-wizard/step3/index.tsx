"use client"

import { Button } from "@components/common/ui/button"
import { deletePaymentProfile } from "@lib/api/wallet"
import type { BnplProfileDto } from "@lib/types/dto/wallet"
import { Check, CreditCard, Trash2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { usePaymentMethodModalStore } from "../../store/payment-method-modal-store"
import { maskAccountNumber } from "../../utils"

// 계좌 등록 스텝 컴포넌트
export default function BankAccountStep({
  bnplProfiles,
}: {
  bnplProfiles: BnplProfileDto[]
}) {
  // 결제수단 등록 모달 오픈
  const { openModal } = usePaymentMethodModalStore()

  return (
    <div className="min-h-96">
      {bnplProfiles.length === 0 ? (
        <EmptyMessage message="등록된 계좌가 없습니다." />
      ) : (
        <BankAccountList bnplProfiles={bnplProfiles} />
      )}

      <div className="bg-background fixed bottom-0 left-0 w-full px-4 pb-4">
        <Button variant="default" className="w-full" onClick={openModal}>
          + {bnplProfiles.length === 0 ? "결제수단 등록" : "결제수단 추가"}
        </Button>
      </div>
    </div>
  )
}

function BankAccountList({ bnplProfiles }: { bnplProfiles: BnplProfileDto[] }) {
  return (
    <div>
      <p className="text-sm font-medium">
        등록 계좌 <span className="font-bold">{bnplProfiles.length}개</span>
      </p>

      <ul className="absolute right-0 left-0 mt-4 px-3">
        {bnplProfiles.map((paymentProfile, index) => (
          <BankAccountItem
            key={paymentProfile.id}
            paymentProfile={paymentProfile}
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
}: {
  paymentProfile: BnplProfileDto
  style?: React.CSSProperties
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
          className="text-muted-foreground hover:text-destructive"
          disabled={isPending}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  )
}

function EmptyMessage({ message }: { message: string }) {
  return <p className="text-muted-foreground text-sm">{message}</p>
}
