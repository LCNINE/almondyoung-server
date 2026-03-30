import Link from "next/link"
import { Package, Heart, ShoppingBag, Eye } from "lucide-react"

export function QuickMenuSection() {
  const menuItems = [
    {
      label: "주문목록",
      icon: <Package size={32} className="text-amber-500" />,
      href: "/kr/mypage/order/list",
    },
    {
      label: "찜한상품",
      icon: <Heart size={32} className="text-amber-500" />,
      href: "/kr/mypage/wish",
    },
    {
      label: "자주산상품",
      icon: <ShoppingBag size={32} className="text-amber-500" />,
      href: "/kr/mypage/rebuy",
    },
    {
      label: "최근 본 상품",
      icon: <Eye size={32} className="text-amber-500" />,
      href: "/kr/mypage/recent",
    },
  ]

  return (
    <nav className="rounded-lg bg-white">
      {/* Outer Container - 최대 좌우 여백 제한 */}
      <div className="px-5 py-4">
        {/* Inner Container - 아이콘 그룹 최대 너비 제한 + 중앙 정렬 */}
        <div className="mx-auto max-w-[600px]">
          {/* Menu List - gap으로 고정 간격 */}
          <ul className="grid grid-cols-4 gap-8">
            {menuItems.map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className="flex w-full flex-col items-center gap-2 transition-opacity hover:opacity-70"
                >
                  <div className="flex h-10 w-10 items-center justify-center">
                    {item.icon}
                  </div>
                  <span className="font-['Pretendard'] text-sm font-medium text-black">
                    {item.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </nav>
  )
}
