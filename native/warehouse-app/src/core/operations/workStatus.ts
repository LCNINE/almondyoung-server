import type { StoredOperation } from './operationStore';
export function workStatus(operations: StoredOperation[], now: number) {
  if (!operations.length) return { message: null, blocksWork: false };
  if (operations.some((o) => now - o.createdAt >= 29 * 86400000))
    return {
      message: '오래된 작업이 있어요. 관리자와 처리 내역을 확인해 주세요.',
      blocksWork: true,
    };
  if (operations.some((o) => o.status === 'uncertain'))
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
