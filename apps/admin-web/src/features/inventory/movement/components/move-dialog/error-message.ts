import { parseServerError } from '../../../../../lib/api/server-error';

export function movementErrorMessage(error: unknown): string {
  const parsed = parseServerError(error, '이동에 실패했습니다.');
  if (parsed.status === 409 && parsed.code === 'INBOUND_ORIGIN_STOCK_PROTECTED')
    return '이 상품은 적치 대기 중이에요. 창고 앱의 적치에서 입고 건을 선택해 처리해 주세요.';
  if (
    parsed.status === 409 &&
    parsed.code === 'INBOUND_ORIGIN_STOCK_INCONSISTENT'
  )
    return '입고 기록과 현재 재고가 맞지 않아요. 입고내역과 실물을 확인해 주세요.';
  if (
    parsed.status === 409 &&
    parsed.code === 'INBOUND_PUTAWAY_DESTINATION_INVALID'
  )
    return '같은 창고의 일반 로케이션을 선택해 주세요.';
  return parsed.message;
}
