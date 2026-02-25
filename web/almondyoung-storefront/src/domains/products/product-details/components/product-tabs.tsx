type Tab = "detail" | "review" | "qna" | "info"

type Props = {
  activeTab: Tab
  reviewCount: number
  qnaCount: number
  onTabChange: (tab: Tab) => void
}

function TabCount({ count }: { count: number }) {
  if (count <= 0) return null

  return (
    <span className="ml-0.5 inline-block animate-fade-in text-[0.65em] tabular-nums opacity-80">
      {count.toLocaleString()}
    </span>
  )
}

/**
 * @description 상품 정보 탭 네비게이션
 */
export function ProductTabs({
  activeTab,
  reviewCount,
  qnaCount,
  onTabChange,
}: Props) {
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "detail", label: "상세정보", count: 0 },
    { id: "review", label: "리뷰", count: reviewCount },
    { id: "qna", label: "Q&A", count: qnaCount },
    { id: "info", label: "구매/반품 안내", count: 0 },
  ]

  return (
    <nav
      className="sticky top-0 z-10 mb-8 rounded-lg bg-white"
      role="tablist"
      aria-label="상품 정보 탭"
    >
      <ul className="flex border-b">
        {tabs.map((tab) => (
          <li key={tab.id} className="flex-1">
            <button
              role="tab"
              aria-selected={activeTab === tab.id}
              aria-controls={`${tab.id}-panel`}
              onClick={() => onTabChange(tab.id)}
              className={`w-full px-2 py-4 text-center text-xs lg:text-base ${
                activeTab === tab.id
                  ? "border-b-2 border-blue-500 text-blue-500"
                  : "text-gray-600"
              }`}
            >
              {tab.label}
              <TabCount count={tab.count} />
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
