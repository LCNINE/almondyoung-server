import { MembershipForm } from "./components"

// 순수 UI 데모용 데이터
const mockPlans = {
  monthly: { days: 30, price: 4990 },
  yearly: { days: 365, price: 49900 },
}

const mockBenefits = [
  {
    id: "trial-1",
    type: "trial" as const,
    title: "신규 가입 무료 체험",
    days: 7,
    used: false,
    isSuspended: false,
  },
  {
    id: "discount-1",
    type: "discount" as const,
    title: "첫 구독 할인",
    percentage: 20,
    maxUses: 3,
    usedPayments: [],
    isSuspended: false,
  },
]

export default function MembershipFormPage() {
  return (
    <>
      <MembershipForm
        memberId="demo-user-id"
        plans={mockPlans}
        existingFmsMember={null}
        existingSubType={null}
        availableBenefits={mockBenefits}
      />
    </>
  )
}
