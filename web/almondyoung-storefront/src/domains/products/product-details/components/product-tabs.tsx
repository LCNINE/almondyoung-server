type Tab = "detail" | "review" | "qna" | "info"

type Props = {
  activeTab: Tab
  reviewCount: number
  qnaCount: number
  onTabChange: (tab: Tab) => void
}

/**
 * @description 상품 정보 탭 네비게이션
 * 시맨틱: <nav>와 role="tablist" 사용
 */
export function ProductTabs({
  activeTab,
  reviewCount,
  qnaCount,
  onTabChange,
}: Props) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "detail", label: "상세정보" },
    { id: "review", label: `리뷰 ${reviewCount}` },
    { id: "qna", label: `Q&A ${qnaCount}` },
    { id: "info", label: "구매, 반품/교환 정보안내" },
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
              className={`w-full py-4 text-center ${
                activeTab === tab.id
                  ? "border-b-2 border-blue-500 text-blue-500"
                  : "text-gray-600"
              }`}
            >
              {tab.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
