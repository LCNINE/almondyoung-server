import { permissionNames } from '../auth/permissionNames';
import type { StoredOperation } from './operationStore';
// 응답 필터는 403 을 FORBIDDEN 으로, Nest 기본 예외 본문은 Forbidden 으로 싣는다.
const deniedByPermission = (o: StoredOperation) =>
  o.errorStatus === 403 ||
  Boolean(o.requiredPermissions?.length) ||
  o.errorCode === 'FORBIDDEN' ||
  o.errorCode === 'Forbidden';
export function workStatus(operations: StoredOperation[], now: number) {
  if (!operations.length) return { message: null, blocksWork: false };
  if (operations.some((o) => now - o.createdAt >= 29 * 86400000))
    return {
      message: '오래된 작업이 있어요. 관리자와 처리 내역을 확인해 주세요.',
      blocksWork: true,
    };
  const uncertain = operations.filter((o) => o.status === 'uncertain');
  // 권한에서 막힌 요청도 그 전 시도가 반영됐을 수 있어 결과는 단정하지 않는다. 「처리 내역 확인」이
  // 같은 키로 다시 보내고, 새 역할을 받았으면 토큰이 바뀌어야 하므로 다시 로그인이 필요하다.
  if (uncertain.length && uncertain.every(deniedByPermission)) {
    const groups = uncertain.every((o) => o.requiredPermissions?.length)
      ? new Set(
          uncertain.map((o) => permissionNames(o.requiredPermissions ?? []))
        )
      : new Set<string>();
    const what = groups.size ? `${[...groups].join(', ')} 권한` : '권한';
    return {
      message: `${what}이 없어 처리 결과를 확인하지 못했어요. 관리자에게 권한을 받은 뒤 「처리 내역 확인」을 누르고, 그래도 같으면 다시 로그인해 주세요.`,
      blocksWork: true,
    };
  }
  if (uncertain.length)
    return {
      message: '처리 여부를 확인하고 있어요. 이 상품은 다시 찍지 마세요.',
      blocksWork: true,
    };
  return {
    message: operations.some((o) => now - o.createdAt >= 1500)
      ? '확인하고 있어요.'
      : null,
    blocksWork: true,
  };
}
