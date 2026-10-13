import { HydrationBoundary } from '@tanstack/react-query';
import { getMyPermissions } from '@/lib/auth/my-permissions.server';
import { myPermissionsSeed } from '@/lib/auth/my-permissions-seed';

/**
 * 첫 진입 때 서버가 받은 내 권한을 브라우저 쿼리 캐시에 미리 넣는다(셸·화면 버튼이 같은 조회를 기다리지 않게).
 * 사이드바(레이아웃)가 먼저 같은 쿼리를 만들기 전에 채워야 하므로 레이아웃 «바깥»에 둔다.
 * 같은 요청의 화면 가드와 `cache()` 로 한 번만 조회한다. 받지 못했으면 아무것도 넣지 않는다(브라우저가 직접 받는다).
 */
export async function MyPermissionsHydration({ children }: { children: React.ReactNode }) {
  if (process.env.BYPASS_AUTH === 'true') return <>{children}</>;
  // 미리 넣기는 최적화일 뿐이다 — 조회가 던져도(인증 설정 누락 등) 레이아웃을 깨지 않고 브라우저가 직접 받게 둔다
  const state = await getMyPermissions().catch(() => null);
  if (state?.state !== 'ready') return <>{children}</>;
  const seed = myPermissionsSeed({ roles: state.roles, permissions: state.permissions, version: state.version }, state.fetchedAt);
  return <HydrationBoundary state={seed}>{children}</HydrationBoundary>;
}
