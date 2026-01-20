import { ChevronRight } from "lucide-react"
import Link from "next/link"

const menuItems = [
  // { label: "계좌 사용 내역", href: "/mypage/payment/history" },
  { label: "결제 비밀번호 / 보안 설정", href: "/mypage/payment/security" },
  { label: "현금영수증 설정", href: "/mypage/payment/receipt" },
  { label: "나중결제 약관 및 정책", href: "/mypage/payment/terms" },
]

export default function PaymentMenuList() {
  return (
    <div className="mt-8">
      {menuItems.map((item, idx) => (
        <Link
          key={item.href}
          href={item.href}
          className={`border-gray-20 hover:bg-gray-10 flex cursor-pointer items-center justify-between border-t px-7 py-4 ${idx === menuItems.length - 1 ? "border-b" : ""} `}
        >
          <span className="text-sm">{item.label}</span>
          <ChevronRight className="h-4 w-4 text-gray-400" />
        </Link>
      ))}
    </div>
  )
}
