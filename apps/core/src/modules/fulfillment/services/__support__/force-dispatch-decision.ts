import { getPermissionDecision, PermissionDecision, recordPermissionDecisions } from '@app/authorization';

/** 라우트의 PermissionGuard 가 그 권한을 통과시킨 요청에 남기는 판정 — 위조 불가라 실제 기록 함수로 만든다. */
export function grantedPermissionDecision(permission: string): PermissionDecision {
  const request = {};
  recordPermissionDecisions(request, [permission]);
  const decision = getPermissionDecision(request, permission);
  if (!decision) throw new Error(`permission decision was not recorded: ${permission}`);
  return decision;
}
