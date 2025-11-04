// Mock data for user recent views
export interface RecentView {
  id: string
  userId: string
  productId: string
  productName: string
  productImage: string
  viewedAt: string
  category: string
}

export interface ViewStatistics {
  totalViews: number
  uniqueProducts: number
  mostViewedCategory: string
  averageViewsPerDay: number
}

// Mock recent views data
const mockRecentViews: RecentView[] = [
  {
    id: "1",
    userId: "user1",
    productId: "prod1",
    productName: "Sample Product 1",
    productImage: "/images/product1.jpg",
    viewedAt: "2024-01-01T10:00:00Z",
    category: "skincare"
  },
  {
    id: "2",
    userId: "user1",
    productId: "prod2",
    productName: "Sample Product 2",
    productImage: "/images/product2.jpg",
    viewedAt: "2024-01-02T11:00:00Z",
    category: "makeup"
  }
]

// Mock functions
export function getRecentViews(): RecentView[] {
  return mockRecentViews
}

export function getRecentViewsByUserId(userId: string): RecentView[] {
  return mockRecentViews.filter(view => view.userId === userId)
}

export function addRecentView(view: Omit<RecentView, 'id' | 'viewedAt'>): RecentView {
  const newView: RecentView = {
    ...view,
    id: Date.now().toString(),
    viewedAt: new Date().toISOString()
  }
  mockRecentViews.unshift(newView)
  return newView
}

export function getFrequentlyViewedProducts(userId: string, limit: number = 5): RecentView[] {
  const userViews = getRecentViewsByUserId(userId)
  const productCounts = new Map<string, number>()
  
  userViews.forEach(view => {
    const count = productCounts.get(view.productId) || 0
    productCounts.set(view.productId, count + 1)
  })
  
  const sortedProducts = Array.from(productCounts.entries())
    .sort(([,a], [,b]) => b - a)
    .slice(0, limit)
    .map(([productId]) => userViews.find(view => view.productId === productId))
    .filter(Boolean) as RecentView[]
  
  return sortedProducts
}

export function getViewStatistics(userId: string): ViewStatistics {
  const userViews = getRecentViewsByUserId(userId)
  const uniqueProducts = new Set(userViews.map(view => view.productId)).size
  const categoryCounts = new Map<string, number>()
  
  userViews.forEach(view => {
    const count = categoryCounts.get(view.category) || 0
    categoryCounts.set(view.category, count + 1)
  })
  
  const mostViewedCategory = Array.from(categoryCounts.entries())
    .sort(([,a], [,b]) => b - a)[0]?.[0] || "none"
  
  const daysDiff = userViews.length > 0 
    ? (Date.now() - new Date(userViews[userViews.length - 1].viewedAt).getTime()) / (1000 * 60 * 60 * 24)
    : 1
  
  return {
    totalViews: userViews.length,
    uniqueProducts,
    mostViewedCategory,
    averageViewsPerDay: userViews.length / Math.max(daysDiff, 1)
  }
}
