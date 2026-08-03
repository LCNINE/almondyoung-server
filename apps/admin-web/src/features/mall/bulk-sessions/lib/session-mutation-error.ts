// src/features/mall/bulk-sessions/lib/session-mutation-error.ts
// 세션 phase 를 바꾸는 뮤테이션(승인·취소·발행·재시도 등)의 공통 409 처리.
//
// 스펙 §3.10: 409 는 두 가지 다른 이유를 함께 나른다 — (a) 다른 탭/사용자가 세션
// phase 를 먼저 바꿨거나, (b) 지금 phase 에서 정당하게 거부됐다("발행할 행이
// 없습니다" 등, bulk-session.manager.ts 참조). 서버는 둘을 구분하지 않고 같은 409 로
// 보낸다 — 어느 쪽이든 진행률을 다시 읽어 화면을 최신 phase 로 맞추고(무효화만 하면
// 되는 이유는 아래), 실제 사유는 getServerDenyMessage 로 토스트에 그대로 실어
// 보낸다. (b) 를 고정 문장으로 덮으면 조작자가 왜 거부됐는지 못 읽고 같은 버튼을
// 계속 누른다 — 바로 그 루프를 막으려던 처리가 스스로 그 루프를 만드는 셈이다.
//
// 무효화가 필요한 이유: useSessionMutation 의 onSuccess(진행률·목록 무효화)는 실패
// 시 돌지 않고, bulkSessionRefetchInterval 은 drafted/published/canceled 에서
// false 를 반환하며 전역 refetchOnWindowFocus 도 꺼져 있어(query-client 설정)
// 아무것도 자동으로 다시 읽어오지 않는다. 여기서 진행률 쿼리를 직접 무효화해 상위
// 화면이 바뀐 phase 로 다시 분기하게 한다. review-panel 의 handleApprove 가 원래
// 하던 처리를 그대로 옮긴 것 — 그 패널만 가진 특별 취급이 아니라 세션 뮤테이션이면
// 공통으로 필요하다.
import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getServerDenyMessage, parseServerError } from '@/lib/api/server-error';
import { productQueryKeys } from '@/lib/services/products/query-keys';

export function notifySessionMutationError(
  error: unknown,
  qc: QueryClient,
  sessionId: string
): void {
  const parsed = parseServerError(error);
  // 이 앱 전역에서 409/403 을 사람이 읽는 문장으로 바꾸는 기존 관용구를 그대로 쓴다
  // (getServerDenyMessage) — 서버 메시지를 고정 문장으로 덮지 않는다.
  toast.error(getServerDenyMessage(error));
  if (parsed.conflict) {
    void qc.invalidateQueries({
      queryKey: productQueryKeys.bulkSession(sessionId),
    });
  }
}
