'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { shouldRefreshPermissionsAfter403 } from '@/lib/auth/permission-check';
import { authQueryKeys } from '@/lib/services/auth/query-keys';

/** API 가 403 을 주면 내 권한을 다시 읽는다 — 그사이 역할·매핑이 바뀌었을 수 있다. 안내 토스트는 각 화면의 오류 처리가 띄운다. */
export function PermissionDeniedHandler() {
  const queryClient = useQueryClient();
  const lastRefreshAt = useRef(0);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail: unknown = event instanceof CustomEvent ? event.detail : undefined;
      const url =
        typeof detail === 'object' && detail !== null && 'url' in detail && typeof detail.url === 'string'
          ? detail.url
          : undefined;
      const now = Date.now();
      if (!shouldRefreshPermissionsAfter403(url, lastRefreshAt.current, now)) return;
      lastRefreshAt.current = now;
      void queryClient.invalidateQueries({ queryKey: authQueryKeys.myPermissions() });
    };
    window.addEventListener('auth:permission-denied', handler);
    return () => window.removeEventListener('auth:permission-denied', handler);
  }, [queryClient]);
  return null;
}
