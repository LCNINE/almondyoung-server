import type { ContactOutcome } from '@/lib/api/domains/orders/order-cs.shape';

export interface ContactDraft {
  /** 이 글의 요청 id — 응답을 못 받아 다시 눌러도 한 번만 남는다 */
  requestId: string;
  outcome: ContactOutcome | null;
  body: string;
  followUpOn: string;
}
/** base 는 고치기 시작할 때 본 메모 */
export interface MemoDraft {
  text: string;
  base: string;
}
export interface CsDraft {
  contact: ContactDraft;
  memo: MemoDraft | null;
}
/** 주문마다 적던 글. 목록이 다시 읽히거나 단계를 옮겨 다녀도 남게 보드가 들고 있다. */
export type CsDrafts = Record<string, CsDraft>;
export type SetCsDraft = (
  salesOrderId: string,
  change: (draft: CsDraft) => CsDraft
) => void;

export const emptyContactDraft = (): ContactDraft => ({
  requestId: crypto.randomUUID(),
  outcome: null,
  body: '',
  followUpOn: '',
});
export const emptyCsDraft = (): CsDraft => ({
  contact: emptyContactDraft(),
  memo: null,
});
