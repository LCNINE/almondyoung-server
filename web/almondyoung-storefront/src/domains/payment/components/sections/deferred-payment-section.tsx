import { Button } from "@components/common/ui/button"
import { Card, CardContent } from "@components/common/ui/card"
import { Price } from "@components/price"
import EmptyState from "../empty-state"

// 나중결제 내역 섹션
export default function DeferredPaymentSection({
  onPaymentRegisterClick,
}: {
  onPaymentRegisterClick: () => void
}) {
  const account = false

  if (!account) {
    return (
      <EmptyState
        message="아직 등록한 계좌가 없습니다"
        contentClassName="p-0! py-4! pl-0! md:pl-2!"
        action={
          <Button
            variant="default"
            className="w-full cursor-pointer px-6 font-medium sm:w-auto"
            onClick={onPaymentRegisterClick}
          >
            + 결제수단 등록
          </Button>
        }
      />
    )
  }

  return <section className="bg-gray-10 p-4"></section>
}
