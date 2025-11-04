import { 
  addToWishlist, 
  getWishlist, 
  removeFromWishlist 
} from "@lib/api/users/wishlist"
import { WishlistItem } from "@lib/api/users/wishlist"
import { USER_API_CONFIG } from "@lib/constants/user-api"
import { emitWishlistChange } from "./wishlist-events"

// 서비스 옵션 타입
export interface WishlistServiceOpts {
  /** 사용자 ID */
  userId?: string
  /** 캐시 사용 여부 */
  useCache?: boolean
}

// 캐시 타입
type CachedWishlist = {
  items: WishlistItem[]
  lastFetched: number
  userId: string
}

// 로컬 스토리지 키 생성
const getCacheKey = (userId: string) => `wishlist_${userId}`

// 캐시 읽기
function readCache(userId: string): CachedWishlist | null {
  if (typeof window === 'undefined') return null
  
  try {
    const cached = localStorage.getItem(getCacheKey(userId))
    if (!cached) return null
    
    const data = JSON.parse(cached) as CachedWishlist
    const now = Date.now()
    
    // 캐시 유효성 검사
    if (now - data.lastFetched > USER_API_CONFIG.CACHE_TTL) {
      localStorage.removeItem(getCacheKey(userId))
      return null
    }
    
    return data
  } catch {
    return null
  }
}

// 캐시 쓰기
function writeCache(userId: string, items: WishlistItem[]): void {
  if (typeof window === 'undefined') return
  
  try {
    const data: CachedWishlist = {
      items,
      lastFetched: Date.now(),
      userId
    }
    localStorage.setItem(getCacheKey(userId), JSON.stringify(data))
  } catch {
    // 캐시 쓰기 실패는 무시
  }
}

// 캐시 무효화
function invalidateCache(userId: string): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(getCacheKey(userId))
}

/**
 * 위시리스트 조회 서비스
 */
export async function getWishlistService(
  opts: WishlistServiceOpts = {}
): Promise<WishlistItem[]> {
  const { userId, useCache = true } = opts

  // 사용자 ID가 없으면 빈 배열 반환
  if (!userId) {
    return []
  }

  // 캐시 사용 시 캐시에서 먼저 확인
  if (useCache) {
    const cached = readCache(userId)
    if (cached) {
      return cached.items
    }
  }

  try {
    const items = await getWishlist()
    
    // 캐시에 저장
    if (useCache) {
      writeCache(userId, items)
    }
    console.log("위시리스트 조회 서비스 items", items)
    return items
  } catch (error) {
    console.error("위시리스트 조회 실패:", error)
    throw error
  }
}

/**
 * 위시리스트에 상품 추가 서비스
 */
export async function addToWishlistService(
  productId: string,
  opts: WishlistServiceOpts = {}
): Promise<void> {
  try {
    await addToWishlist(productId)
    // 이벤트 발생
    emitWishlistChange('add')
  } catch (error) {
    console.error("위시리스트 추가 실패:", error)
    throw error
  }
}

/**
 * 위시리스트에서 상품 제거 서비스
 */
export async function removeFromWishlistService(
  wishlistId: string,
  opts: WishlistServiceOpts = {}
): Promise<void> {
  try {
    await removeFromWishlist(wishlistId)
    // 이벤트 발생
    emitWishlistChange('remove')
  } catch (error) {
    console.error("위시리스트 제거 실패:", error)
    throw error
  }
}

/**
 * 상품이 위시리스트에 있는지 확인하는 서비스
 */
export async function isProductInWishlistService(
  productId: string,
  opts: WishlistServiceOpts = {}
): Promise<boolean> {
  try {
    const wishlist = await getWishlistService(opts)
    return wishlist.some(item => item.productId === productId)
  } catch (error) {
    console.error("위시리스트 확인 실패:", error)
    return false
  }
}

/**
 * 위시리스트 토글 서비스 (추가/제거)
 */
export async function toggleWishlistService(
  productId: string,
  opts: WishlistServiceOpts = {}
): Promise<{ added: boolean; wishlistId?: string }> {
  const { userId, useCache = true } = opts

  try {
    // 현재 위시리스트 상태 확인
    const wishlist = await getWishlistService({ ...opts, useCache: false })
    const existingItem = wishlist.find(item => item.productId === productId)

    if (existingItem) {
      // 이미 있으면 제거
      await removeFromWishlistService(existingItem.id, opts)
      return { added: false }
    } else {
      // 없으면 추가
      await addToWishlistService(productId, opts)
      return { added: true }
    }
  } catch (error) {
    console.error("위시리스트 토글 실패:", error)
    throw error
  }
}
