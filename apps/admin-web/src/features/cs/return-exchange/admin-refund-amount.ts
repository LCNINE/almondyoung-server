import type { ReturnRefundQuote } from '@/lib/api/domains/return-exchange';

export type CompletionDecision =
  | { kind: 'complete_now' }
  | { kind: 'ask_amount'; cap: number }
  | { kind: 'blocked'; message: string };

export function decideCompletion(
  quote: ReturnRefundQuote,
  canEnterAmount: boolean
): CompletionDecision {
  if (quote.kind === 'automatic') return { kind: 'complete_now' };
  if (!canEnterAmount) {
    return {
      kind: 'blocked',
      message:
        '세트 구성품 일부 반품은 환불 실행 권한이 있어야 완료할 수 있습니다.',
    };
  }
  return { kind: 'ask_amount', cap: quote.cap };
}

export function parseAdminRefundAmount(
  input: string,
  cap: number
): { ok: true; amount: number } | { ok: false; message: string } {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, message: '환불 금액을 0 이상의 정수로 입력하세요.' };
  }
  const amount = Number(trimmed);
  if (!Number.isSafeInteger(amount)) {
    return { ok: false, message: '환불 금액을 0 이상의 정수로 입력하세요.' };
  }
  if (amount > cap) {
    return { ok: false, message: `상한 ${cap}원을 넘을 수 없습니다.` };
  }
  return { ok: true, amount };
}
