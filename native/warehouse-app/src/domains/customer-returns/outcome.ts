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
