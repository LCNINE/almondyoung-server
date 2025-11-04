// 최근 검색어 관리 유틸리티

const SEARCH_HISTORY_KEY = 'almondyoung_search_history'
const MAX_HISTORY_ITEMS = 10

export interface SearchHistoryItem {
  query: string
  timestamp: number
  date: string // "10.29." 형태
}

// 최근 검색어 저장
export function saveSearchHistory(query: string): void {
  if (!query.trim()) return
  
  try {
    const existingHistory = getSearchHistory()
    
    // 중복 제거 (같은 검색어가 있으면 제거)
    const filteredHistory = existingHistory.filter(item => item.query !== query.trim())
    
    // 새로운 검색어를 맨 앞에 추가
    const newItem: SearchHistoryItem = {
      query: query.trim(),
      timestamp: Date.now(),
      date: formatDate(new Date())
    }
    
    const updatedHistory = [newItem, ...filteredHistory].slice(0, MAX_HISTORY_ITEMS)
    
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updatedHistory))
  } catch (error) {
    console.error('검색 기록 저장 실패:', error)
  }
}

// 최근 검색어 조회
export function getSearchHistory(): SearchHistoryItem[] {
  try {
    const stored = localStorage.getItem(SEARCH_HISTORY_KEY)
    if (!stored) return []
    
    const history = JSON.parse(stored) as SearchHistoryItem[]
    return Array.isArray(history) ? history : []
  } catch (error) {
    console.error('검색 기록 조회 실패:', error)
    return []
  }
}

// 최근 검색어 삭제
export function removeSearchHistory(query: string): void {
  try {
    const existingHistory = getSearchHistory()
    const filteredHistory = existingHistory.filter(item => item.query !== query)
    
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(filteredHistory))
  } catch (error) {
    console.error('검색 기록 삭제 실패:', error)
  }
}

// 모든 검색 기록 삭제
export function clearSearchHistory(): void {
  try {
    localStorage.removeItem(SEARCH_HISTORY_KEY)
  } catch (error) {
    console.error('검색 기록 전체 삭제 실패:', error)
  }
}

// 날짜 포맷팅 (MM.DD. 형태)
function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}.${day}.`
}
