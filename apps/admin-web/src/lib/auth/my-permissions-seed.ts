import { QueryClient, dehydrate, type DehydratedState } from '@tanstack/react-query';
import { authQueryKeys } from '@/lib/services/auth/query-keys';
import type { MyPermissions } from './my-permissions';

/**
 * 서버가 화면 진입을 판정하며 이미 받은 내 권한을 브라우저 쿼리 캐시에 넘길 상태(TanStack Query SSR 의 dehydrate).
 * 받은 시각을 그대로 실어 브라우저의 30초 신선도 규칙이 이어지고, 브라우저에 더 새 사본이 있으면 덮지 않는다.
 * 첫 진입에서 쓰기 버튼이 권한 조회를 기다리며 늦게 나타나지 않게 하고, 그 조회 요청 한 번을 줄인다.
 */
export function myPermissionsSeed(value: MyPermissions, fetchedAt: number): DehydratedState {
  const client = new QueryClient();
  client.setQueryData(authQueryKeys.myPermissions(), value, { updatedAt: fetchedAt });
  return dehydrate(client);
}
