'use client';

import { authApi } from '@/lib/api';
import { useMutation } from '@tanstack/react-query';
import type { PermissionRequirement } from '@/lib/auth/mutation-permission';

/**
 * 테넌트 셸의 로그아웃. `useSignout` 과 달리 근태 푸시를 해지하지 않는다 — 그 해지는 notification(테넌트 1 만 섬김)을 부르고, 테넌트
 * 셸에는 근태 화면이 없다. 따로 파일에 둔다(같은 파일에 두면 테넌트 셸 게이트가 notification 까지 닿는다고 센다).
 */
export const useTenantShellSignout = () => {
  return useMutation({
    mutationFn: () => authApi.signout(),
  });
};
useTenantShellSignout.permission = 'self' as const satisfies PermissionRequirement;
