import type { QueryClient } from '@tanstack/react-query';
import type { MyPermissions } from '@/lib/auth/my-permissions';
import { authQueryKeys } from '@/lib/services/auth/query-keys';

/** 근태 관리 권한 전부(오늘 master 가 받는 근태 권한). */
export const ATTENDANCE_MANAGER_PERMISSIONS = [
  'attendance.own.write',
  'attendance.staff.read',
  'attendance.request.review',
  'attendance.statistics.read',
  'attendance.worksite.write',
];

/** 화면 스펙이 «내 권한» 조회 결과를 미리 심는다. */
export function seedPermissions(
  client: QueryClient,
  permissions: readonly string[]
) {
  const value: MyPermissions = {
    roles: [],
    permissions: new Set(permissions),
    version: 'test',
    landingPath: null,
  };

  client.setQueryData(authQueryKeys.myPermissions(), value);
}

/** «내 권한» 조회가 실패한 상태를 만든다(사본 없음). */
export async function failPermissions(client: QueryClient) {
  await client.prefetchQuery({
    queryKey: authQueryKeys.myPermissions(),
    queryFn: () => Promise.reject(new Error('permissions unavailable')),
    retry: false,
  });
}

/** 한 번 받은 사본이 있는 채로 재조회가 실패한 상태를 만든다. */
export async function failPermissionsRefetch(
  client: QueryClient,
  permissions: readonly string[]
) {
  seedPermissions(client, permissions);

  await client.prefetchQuery({
    queryKey: authQueryKeys.myPermissions(),
    queryFn: () => Promise.reject(new Error('permissions unavailable')),
    retry: false,
    staleTime: 0,
  });
}
