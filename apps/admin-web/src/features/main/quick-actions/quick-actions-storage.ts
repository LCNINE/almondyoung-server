import { QUICK_ACTION_POOL_IDS } from './quick-actions.config';

/**
 * 유저별 빠른 액션 설정.
 * - order: 노출 순서(id 배열)
 * - hidden: 풀에는 있지만 내 빠른 액션에서 뺀 id
 *
 * hidden 기반이라 풀에 새 메뉴가 추가돼도 "뺀 적 없는" 기존 유저에겐 자동 노출된다.
 */
export interface QuickActionPref {
  order: string[];
  hidden: string[];
}

/**
 * 저장 어댑터. 지금은 localStorage 구현만 쓰지만,
 * 나중에 백엔드(user-service preference API)로 옮길 때 이 인터페이스 구현만 갈아끼우면 된다.
 */
export interface QuickActionStore {
  load(userId: string): QuickActionPref | null;
  save(userId: string, pref: QuickActionPref): void;
}

const KEY_PREFIX = 'quick-actions:';

function isValidPref(value: unknown): value is QuickActionPref {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.order) &&
    Array.isArray(v.hidden) &&
    v.order.every((x) => typeof x === 'string') &&
    v.hidden.every((x) => typeof x === 'string')
  );
}

export const localQuickActionStore: QuickActionStore = {
  load(userId) {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.localStorage.getItem(KEY_PREFIX + userId);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!isValidPref(parsed)) return null;
      // 풀에서 사라진 id 는 정리해서 돌려준다(메뉴가 제거된 경우 대비).
      const known = new Set(QUICK_ACTION_POOL_IDS);
      return {
        order: parsed.order.filter((id) => known.has(id)),
        hidden: parsed.hidden.filter((id) => known.has(id)),
      };
    } catch {
      return null;
    }
  },
  save(userId, pref) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(KEY_PREFIX + userId, JSON.stringify(pref));
    } catch {
      // 용량 초과 등은 무시 — 설정 저장 실패가 앱 동작을 막아선 안 된다.
    }
  },
};
