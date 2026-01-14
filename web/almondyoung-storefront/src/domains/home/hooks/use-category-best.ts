import { useState, useCallback } from "react"

export function useCategoryBest(initialActiveTab: string) {
  const [activeTab, setActiveTab] = useState(initialActiveTab)
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(
    new Set([initialActiveTab])
  )

  // 카테고리 탭 클릭 애니메이션 상태 저장용
  const markAsVisited = useCallback((tab: string) => {
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev
      const next = new Set(prev)
      next.add(tab)

      return next
    })
  }, [])

  return {
    activeTab,
    setActiveTab,
    visitedTabs,
    markAsVisited,
  }
}
