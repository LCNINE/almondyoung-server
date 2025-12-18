"use client"

import { Button } from "@components/common/ui/button"
import { deletePaymentProfile, setDefaultPaymentProfile } from "@lib/api/wallet"
import type { BnplProfileDto } from "@lib/types/dto/wallet"
import { UserDetail } from "@lib/types/ui/user"
import { CreditCard } from "lucide-react"
import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { useBankAccountModalStore } from "../../store/payment-method-modal-store"

// 계좌 등록 스텝 컴포넌트
export default function BankAccountStep({
  onComplete,
  user,
  bnplProfiles,
}: {
  onComplete: () => void
  user: UserDetail
  bnplProfiles: BnplProfileDto[]
}) {
  // 결제수단 등록 모달 오픈
  const { openModal } = useBankAccountModalStore()

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

      <ul className="border-gray-20 absolute right-0 left-0 mt-4 border-y">
        {bnplProfiles.map((paymentProfile, index) => (
          <BankAccountItem
            key={paymentProfile.id}
            paymentProfile={paymentProfile}
            lastItem={index === bnplProfiles.length - 1}
          />
        ))}
      </ul>
    </div>
  )
}

function BankAccountItem({
  paymentProfile,
  lastItem = false,
}: {
  paymentProfile: BnplProfileDto
  lastItem?: boolean
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

  return (
    <li
      className={`flex cursor-pointer items-center justify-between border-b py-6 pr-4 pl-6 ${lastItem ? "border-none" : "border-gray-20 border-b"}`}
    >
      <div className="flex w-full items-center gap-10">
        <div className="flex size-10 items-center justify-center rounded-lg bg-blue-500">
          <CreditCard className="size-5 text-white" />
        </div>

        <div className="flex-2">
          <p className="font-sans text-sm leading-relaxed font-normal">
            {paymentProfile.details?.paymentCompanyName} 계좌
          </p>
          {/* todo: 마스킹 처리 해줘야함 일단 서버에서 안불러오는거같음 */}
          <p className="font-sans text-sm font-normal">1239-*******-****23</p>
        </div>
      </div>

      <Button
        type="button"
        onClick={handleDelete}
        variant="outline"
        className="hover:text-gray-90 size-8 cursor-pointer px-6 font-sans text-sm font-normal hover:bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isPending}
      >
        삭제
      </Button>
    </li>
  )
}

function EmptyMessage({ message }: { message: string }) {
  return <p className="text-muted-foreground text-sm">{message}</p>
}
