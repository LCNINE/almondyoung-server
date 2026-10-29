import {
  hashKey,
  type Query,
  type QueryClient,
  type QueryFilters,
} from '@tanstack/react-query';
import { authQueryKeys } from '@/lib/services/auth/query-keys';
import {
  endReveal,
  isRevealing,
  markRevealShown,
  startReveal,
} from './pii-notices';

const PERMISSIONS = hashKey(authQueryKeys.myPermissions());
/** 권한 쿼리는 원문이 아니다 — 지우면 안내가 «확인 중»으로 깜빡이고, 재조회가 실패하면 [보기]까지 실패로 본다. */
const notPermissions = (query: Query) => query.queryHash !== PERMISSIONS;

/**
 * 원문을 연 화면을 떠날 때(경로 변경·셸 밖으로 나가 언마운트) 부른다. 어느 쿼리가 원문을 받았는지 따지지 않고 권한 쿼리
 * 말고 전부를 처음 상태로 되돌린다 — 다음 화면이 같은 키를 쓰거나(active) `enabled:false` 로 캐시만 읽어도 원문이 남지
 * 않는다. 붙어 있는 쿼리는 [보기] 없이 다시 받는다. 원문을 연 적이 없으면 아무것도 건드리지 않는다.
 */
export function leaveRevealedScreen(queryClient: QueryClient): void {
  if (endReveal()) void queryClient.resetQueries({ predicate: notPermissions });
}

/**
 * [보기] — 이 화면에 붙은 쿼리를 원문으로 다시 받는다. 다 받은 뒤에야 «원문 표시 중»(`shown`)이 되고, 하나라도 실패하면
 * 보기를 끄고 가린 값으로 되돌린다(일부만 원문인 채 «가려져 있다»가 남지 않게).
 */
export async function revealScreen(
  queryClient: QueryClient,
  pathname: string
): Promise<void> {
  startReveal(pathname);
  const attached: QueryFilters = { type: 'active', predicate: notPermissions };
  // 헤더 없이 이미 나간 요청(첫 조회 포함)을 끊는다 — 데이터가 없는 쿼리의 재조회는 도는 요청에 얹히기 때문이다.
  // 끊긴 쿼리는 이전 상태로 돌아가 다음 줄에서 새 요청을 시작한다.
  void queryClient.cancelQueries(attached);
  try {
    await queryClient.refetchQueries(attached, { throwOnError: true });
  } catch {
    if (isRevealing(pathname)) leaveRevealedScreen(queryClient);
    return;
  }
  markRevealShown(pathname);
}
