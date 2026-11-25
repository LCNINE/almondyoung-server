import type { ReturnView } from './types';

/** 검수를 확정하면 서버가 이어서 하는 일 — 반품은 환불 요청, 교환은 교환품 출고 지시(이미 했으면 확정만) */
export function confirmOutcome(
  view: Pick<ReturnView, 'kind' | 'exchangeReleasedAt'>
): {
  next: string;
  done: string;
} {
  if (view.kind !== 'exchange')
    return { next: '환불을 요청해요', done: '환불을 요청했어요' };
  if (view.exchangeReleasedAt) {
    return {
      next: '검수를 확정해요 — 교환품은 이미 출고 지시됐어요',
      done: '검수를 확정했어요',
    };
  }
  return { next: '교환품 출고를 지시해요', done: '교환품 출고를 지시했어요' };
}

export const KIND_LABEL = { return: '반품', exchange: '교환' } as const;

/** 검수가 끝난 뒤 양품을 어디로 가져갈지 — 양품은 반품 자리에 남아 F4 적치 목록에 올라온다 */
export function putawayHint(
  items: ReadonlyArray<{ accepted: number }>
): string {
  const accepted = items.reduce((sum, item) => sum + item.accepted, 0);
  return accepted > 0
    ? `양품 ${accepted}개는 F4 적치에서 선반에 넣어 주세요.`
    : '';
}
