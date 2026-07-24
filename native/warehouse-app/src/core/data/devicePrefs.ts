/**
 * 기기 로컬 설정(창고 선택 등) 저장소. 토큰과 달리 민감정보가 아니라
 * stronghold 를 쓰지 않는다 — Windows·Android 웹뷰 공통으로 localStorage 면 충분하다.
 * 인터페이스로 감싸는 이유는 테스트 주입 하나뿐이다.
 */
export interface DevicePrefs {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export const localStoragePrefs: DevicePrefs = {
  get(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // 저장 실패는 치명적이지 않다 — 세션 동안 메모리 상태로 계속 동작한다.
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // 위와 같음.
    }
  },
};

export function createMemoryPrefs(
  seed: Record<string, string> = {}
): DevicePrefs {
  const map = new Map(Object.entries(seed));
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}
