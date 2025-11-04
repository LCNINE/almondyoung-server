import { QuickLink } from "app/[countryCode]/mypage/types/mypage-types"
import { FileText, Heart, ShoppingCart, Clock } from "lucide-react"
interface QuickMenuSectionProps {
  items: QuickLink[]
}

export function QuickMenuSection({ items }: QuickMenuSectionProps) {
  return (
    <nav className="bg-white rounded-lg">
      {/* Outer Container - 최대 좌우 여백 제한 */}
      <div className="px-5 py-4">
        {/* Inner Container - 아이콘 그룹 최대 너비 제한 + 중앙 정렬 */}
        <div className="mx-auto max-w-[600px]">
          {/* Menu List - gap으로 고정 간격 */}
          <ul className="grid grid-cols-4 gap-8">
            {/* 주문목록 */}
            <li>
              <button
                type="button"
                className="flex w-full flex-col items-center gap-2 transition-opacity hover:opacity-70"
              >
                {/* Icon Container */}
                <div className="flex h-10 w-10 items-center justify-center">
                  <FileText className="h-8 w-8 text-[#FF9500]" />
                </div>
                {/* Label */}
                <span className="font-['Pretendard'] text-sm font-medium text-black">
                  주문목록
                </span>
              </button>
            </li>

            {/* 찜한상품 */}
            <li>
              <button
                type="button"
                className="flex w-full flex-col items-center gap-2 transition-opacity hover:opacity-70"
              >
                {/* Icon Container */}
                <div className="flex h-10 w-10 items-center justify-center">
                  <Heart className="h-8 w-8 text-[#FF9500]" />
                </div>
                {/* Label */}
                <span className="font-['Pretendard'] text-sm font-medium text-black">
                  찜한상품
                </span>
              </button>
            </li>

            {/* 자주산상품 */}
            <li>
              <button
                type="button"
                className="flex w-full flex-col items-center gap-2 transition-opacity hover:opacity-70"
              >
                {/* Icon Container */}
                <div className="flex h-10 w-10 items-center justify-center">
                  <ShoppingCart className="h-8 w-8 text-[#FF9500]" />
                </div>
                {/* Label */}
                <span className="font-['Pretendard'] text-sm font-medium text-black">
                  자주산상품
                </span>
              </button>
            </li>

            {/* 맞춤정보 */}
            <li>
              <button
                type="button"
                className="flex w-full flex-col items-center gap-2 transition-opacity hover:opacity-70"
              >
                {/* Icon Container */}
                <div className="flex h-10 w-10 items-center justify-center">
                  <Clock className="h-8 w-8 text-[#FF9500]" />
                </div>
                {/* Label */}
                <span className="font-['Pretendard'] text-sm font-medium text-black">
                  맞춤정보
                </span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  )
}
