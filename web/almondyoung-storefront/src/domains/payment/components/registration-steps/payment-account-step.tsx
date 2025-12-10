"use client"

import { Button } from "@components/common/ui/button"
import { PaymentProfile } from "@lib/api/wallet"
import { UserDetail } from "@lib/types/ui/user"
import Image from "next/image"
import { usePaymentProfiles } from "../hooks/use-payment-profiles"
import PaymentMethodForm from "../payment-method-form"
import { usePaymentMethodModalStore } from "../store/payment-method-modal-store"

// 계좌 등록 스텝 컴포넌트
export default function PaymentAccountStep({
  onComplete,
  user,
}: {
  onComplete: () => void
  user: UserDetail
}) {
  const { openModal } = usePaymentMethodModalStore()

  const paymentProfiles = usePaymentProfiles()
  console.log("paymentProfiles:", paymentProfiles)
  return (
    <div className="min-h-96">
      {paymentProfiles.length > 0 ? (
        <PaymentAccountList paymentProfiles={paymentProfiles} />
      ) : (
        <EmptyMessage message="등록된 계좌가 없습니다." />
      )}

      <div className="bg-background fixed bottom-0 left-0 w-full px-4 pb-4">
        <Button variant="default" className="w-full" onClick={openModal}>
          + 결제수단 등록
        </Button>
      </div>

      {/* 결제 수단 선택 모달 */}
      <PaymentMethodForm user={user} />
    </div>
  )
}

function PaymentAccountList({
  paymentProfiles,
}: {
  paymentProfiles: PaymentProfile[]
}) {
  return (
    <div>
      <p className="text-sm font-medium">
        등록 계좌 <span className="font-bold">1개</span>
      </p>

      <ul className="border-gray-20 absolute right-0 left-0 mt-4 border-y">
        {/* todo : map으로 변경 */}
        <PaymentAccountItem lastItem={true} />
      </ul>
    </div>
  )
}

function PaymentAccountItem({ lastItem = false }: { lastItem?: boolean }) {
  return (
    <li
      className={`flex items-center justify-between border-b py-6 pr-4 pl-6 ${lastItem ? "border-none" : "border-gray-20 border-b"}`}
    >
      <div className="flex w-full items-center gap-10">
        <div className="">
          <Image
            src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSaPkRBwF_9pdpWRY4dWLE4EHDJwvMJ1A77NQ&s"
            alt="KB 계좌"
            width={32}
            height={32}
            className="size-11 rounded-md object-cover shadow"
            unoptimized
          />
        </div>

        <div className="flex-2">
          <p className="font-sans text-sm leading-relaxed font-normal">
            우리은행 계좌
          </p>
          <p className="font-sans text-sm font-normal">1239-*******-****23</p>
        </div>
      </div>

      <div className="flex-1">
        <Button
          variant="outline"
          className="hover:text-gray-90 size-8 cursor-pointer px-6 font-sans text-sm font-normal hover:bg-transparent"
        >
          삭제
        </Button>
      </div>
    </li>
  )
}

function EmptyMessage({ message }: { message: string }) {
  return <p className="text-muted-foreground text-sm">{message}</p>
}
