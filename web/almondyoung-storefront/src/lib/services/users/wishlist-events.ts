// 찜한 상품 변경 이벤트 관리

type WishlistChangeEvent = 'add' | 'remove' | 'update'

class WishlistEventManager {
  private listeners: Map<string, Set<() => void>> = new Map()

  // 이벤트 리스너 등록
  addEventListener(event: WishlistChangeEvent, callback: () => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
  }

  // 이벤트 리스너 제거
  removeEventListener(event: WishlistChangeEvent, callback: () => void) {
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      eventListeners.delete(callback)
    }
  }

  // 이벤트 발생
  emit(event: WishlistChangeEvent) {
    const eventListeners = this.listeners.get(event)
    if (eventListeners) {
      eventListeners.forEach(callback => callback())
    }
  }

  // 모든 이벤트 리스너 제거
  clear() {
    this.listeners.clear()
  }
}

// 싱글톤 인스턴스
export const wishlistEventManager = new WishlistEventManager()

// 편의 함수들
export const onWishlistChange = (callback: () => void) => {
  wishlistEventManager.addEventListener('add', callback)
  wishlistEventManager.addEventListener('remove', callback)
  wishlistEventManager.addEventListener('update', callback)
}

export const offWishlistChange = (callback: () => void) => {
  wishlistEventManager.removeEventListener('add', callback)
  wishlistEventManager.removeEventListener('remove', callback)
  wishlistEventManager.removeEventListener('update', callback)
}

export const emitWishlistChange = (event: WishlistChangeEvent) => {
  wishlistEventManager.emit(event)
}
