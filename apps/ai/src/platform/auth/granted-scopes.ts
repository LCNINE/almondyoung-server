import { getPermissionDecision, getScopeAuthorizationDecision } from '@app/authorization';
import { AI_SCOPE, type AiScope } from './ai-scopes';

const ALL_AI_SCOPES = Object.values(AI_SCOPE);

/**
 * 이 요청이 가드에서 실제로 통과받은 스코프.
 *
 * `@RequireScopes` 는 OR 조건이라 "들어올 수 있는가" 만 답한다 — 어느 스코프로 들어왔는지는
 * 남지 않는다. 그런데 어드민과 고객이 같은 엔드포인트를 쓰면 그 구분이 곧 도구 권한이다.
 * ScopeGuard 가 통과시킬 때 요청에 남긴 판정을 읽어 그것을 복원한다.
 *
 * master 는 스코프 조회 없이 통과하는데, 그때 가드가 요구 스코프 전부를 통과로 기록하므로
 * 여기서도 전부 받는다 — 마스터가 모든 도구를 쓰는 것은 의도한 동작이다.
 *
 * 새 권한 판정으로 넘어간 서비스(`enforced`)에선 옛 가드가 물러나 그 낙인이 없다. 대신 라우트가 남긴
 * `ai.assistant.use` 낙인으로 어드민 도구를 연다 — 고객용 스코프만 받는 스킬은 아직 없어 도구 목록은 같다.
 */
export function grantedAiScopes(request: unknown, enforced: boolean): AiScope[] {
  if (enforced) return getPermissionDecision(request, 'ai.assistant.use') ? [AI_SCOPE.ASSISTANT] : [];
  return ALL_AI_SCOPES.filter((scope) => getScopeAuthorizationDecision(request, scope)?.granted === true);
}
