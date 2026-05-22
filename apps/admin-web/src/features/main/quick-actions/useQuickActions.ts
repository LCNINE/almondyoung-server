'use client';

import { useMe } from '@/lib/services/auth/queries';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  QUICK_ACTION_POOL,
  type QuickActionItem,
} from './quick-actions.config';
import {
  localQuickActionStore,
  type QuickActionPref,
  type QuickActionStore,
} from './quick-actions-storage';

const store: QuickActionStore = localQuickActionStore;

/**
 * pref → 실제로 카드에 노출할 항목 목록.
 * order 적용 + hidden 제외 + order 에 없는 신규 항목은 풀 순서대로 뒤에 붙인다.
 * (Array.prototype.sort 는 ES2019+ 에서 stable 이므로 동순위는 풀 순서가 유지된다.)
 */
function resolveVisible(pref: QuickActionPref | null): QuickActionItem[] {
  const hidden = new Set(pref?.hidden ?? []);
  const order = pref?.order ?? [];
  const orderIndex = new Map(order.map((id, i) => [id, i] as const));

  return QUICK_ACTION_POOL.filter((item) => !hidden.has(item.id)).sort(
    (a, b) => {
      const ai = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const bi = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    }
  );
}

export function useQuickActions() {
  const { data: me } = useMe();
  const userId = me?.id ?? null;

  const [pref, setPref] = useState<QuickActionPref | null>(null);

  // localStorage 는 클라이언트에서만 읽을 수 있으므로 마운트 후 로드한다.
  // 첫 렌더는 항상 기본(전체 노출) → SSR/CSR hydration mismatch 방지.
  useEffect(() => {
    setPref(userId ? store.load(userId) : null);
  }, [userId]);

  const visibleActions = useMemo(() => resolveVisible(pref), [pref]);

  const savePref = useCallback(
    (next: QuickActionPref) => {
      if (!userId) return;
      store.save(userId, next);
      setPref(next);
    },
    [userId]
  );

  return { visibleActions, pref, savePref, isReady: userId != null };
}
