import { permissionNames } from '../auth/permissionNames';
import { deniedByPermission, isBoxCheck } from './boxChecks';
import type { StoredOperation } from './operationStore';
import { describePendingWork, type PendingWorkPath } from './pendingWork';

export interface WorkStatus {
  message: string | null;
  blocksWork: boolean;
  /** 남은 작업이 있는 화면 — 안내에서 그 화면으로 간다 */
  screen?: PendingWorkPath | null;
}

export function workStatus(all: StoredOperation[], now: number): WorkStatus {
  const old = all.filter((o) => now - o.createdAt >= 29 * 86400000);
  if (old.length) {
    const pending = describePendingWork(old);
    return {
      message: `오래된 작업이 있어요${pending ? `: ${pending.what}` : ''}. 관리자와 처리 내역을 확인해 주세요.`,
      blocksWork: true,
      screen: pending?.screen ?? null,
    };
  }
  // 박스 하나에 묶인 결과 모름은 «확인할 일» 이 따로 보인다 — 기기 전체를 막지 않는다
  const operations = all.filter((o) => !isBoxCheck(o));
  if (!operations.length) return { message: null, blocksWork: false };
  // 다시 보내는 중(두 번째 시도부터)도 결과 모름이다 — 재시도 사이마다 안내와 단추가 바뀌지 않게
  const uncertain = operations.filter(
    (o) =>
      o.status === 'uncertain' || (o.status === 'sending' && o.attempts > 1)
  );
  // 권한에서 막힌 요청도 그 전 시도가 반영됐을 수 있어 결과는 단정하지 않는다. 「처리 내역 확인」이
  // 같은 키로 다시 보내고, 새 역할을 받았으면 토큰이 바뀌어야 하므로 다시 로그인이 필요하다.
  if (uncertain.length && uncertain.every(deniedByPermission)) {
    const groups = uncertain.every((o) => o.requiredPermissions?.length)
      ? new Set(
          uncertain.map((o) => permissionNames(o.requiredPermissions ?? []))
        )
      : new Set<string>();
    const what = groups.size ? `${[...groups].join(', ')} 권한` : '권한';
    const pending = describePendingWork(uncertain);
    return {
      message: `${what}이 없어 ${pending ? `${pending.what}의 ` : ''}처리 결과를 확인하지 못했어요. 관리자에게 권한을 받은 뒤 「처리 내역 확인」을 누르고, 그래도 같으면 다시 로그인해 주세요.`,
      blocksWork: true,
      screen: pending?.screen ?? null,
    };
  }
  const pending = describePendingWork(uncertain);
  if (pending)
    return {
      message: `${pending.what}의 처리 여부를 확인하고 있어요. ${pending.dontRepeat}`,
      blocksWork: true,
      screen: pending.screen,
    };
  return {
    message: operations.some((o) => now - o.createdAt >= 1500)
      ? '확인하고 있어요.'
      : null,
    blocksWork: true,
  };
}
