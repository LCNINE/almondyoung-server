export function QuickMenuSection() {
  return (
    <nav className="rounded-lg bg-white">
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
                <div className="flex h-10 w-10 items-center justify-center">
                  {/* <OrderListIcon size={32} /> */}
                </div>
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
                <div className="flex h-10 w-10 items-center justify-center">
                  {/* <WishlistIcon size={32} /> */}
                </div>
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
                <div className="flex h-10 w-10 items-center justify-center">
                  {/* <FrequentPurchaseIcon size={32} /> */}
                </div>
                <span className="font-['Pretendard'] text-sm font-medium text-black">
                  자주산상품
                </span>
              </button>
            </li>

            {/* 최근 본 상품 */}
            <li>
              <button
                type="button"
                className="flex w-full flex-col items-center gap-2 transition-opacity hover:opacity-70"
              >
                <div className="flex h-10 w-10 items-center justify-center">
                  {/* <RecentViewIcon size={32} /> */}
                </div>
                <span className="font-['Pretendard'] text-sm font-medium text-black">
                  최근 본 상품
                </span>
              </button>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  )
}
