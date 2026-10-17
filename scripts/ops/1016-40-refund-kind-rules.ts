/**
 * #1016 40번 — 옛 환불 행의 «종류» 판정(순수 함수, 스펙 §7). DB·sst 를 import 하지 않는다.
 *
 * 1단계: 사유 코드·결제 의도로 확정. 2단계: 사유 문구 키워드로 «후보»만 낸다(사람이 CSV 로 검토).
 * 3단계: 하나로 좁혀지지 않으면 비워 둔다.
 */
export const KINDS = ['ITEM_CANCEL', 'RETURN', 'PRICE_ADJUSTMENT', 'SUBSCRIPTION_FEE', 'PAYMENT_ERROR'] as const;
export type Kind = (typeof KINDS)[number];

export function isKind(value: string): value is Kind {
  return (KINDS as readonly string[]).includes(value);
}

export type OldRefund = {
  id: string;
  reasonCode: string | null;
  reasonMessage: string | null;
  intentPurpose: string;
  /** 결제 intent metadata 에 planId 가 있다 — 멤버십 첫 결제는 purpose 가 PURCHASE 라 purpose 만으로는 못 가른다 */
  membershipIntent: boolean;
  medusaNotes: string[] | null;
};

export type Verdict =
  | { step: 1; kind: Kind; why: string }
  | { step: 2; candidate: Kind; why: string }
  | { step: 3; why: string };

const ITEM_CANCEL_CODES = new Set([
  'CUSTOMER_REFUND_REQUEST',
  'CUSTOMER_CANCEL',
  'CHANGE_OF_MIND',
  'WRONG_ORDER',
  'FOUND_CHEAPER',
  'DELAY',
  'OTHER',
]);

const MEDUSA_ITEM_CANCEL_NOTE = /^(partial-cancel|channel-cancel):/;

function classifyByCode(r: OldRefund): Verdict | null {
  if (r.intentPurpose === 'SUBSCRIPTION') return { step: 1, kind: 'SUBSCRIPTION_FEE', why: 'intent purpose SUBSCRIPTION' };
  if (r.membershipIntent) return { step: 1, kind: 'SUBSCRIPTION_FEE', why: 'intent metadata planId (멤버십 결제)' };
  const code = r.reasonCode;
  if (code === 'RETURN_COMPLETED') return { step: 1, kind: 'RETURN', why: 'reason_code RETURN_COMPLETED' };
  if (code && ITEM_CANCEL_CODES.has(code)) return { step: 1, kind: 'ITEM_CANCEL', why: `reason_code ${code}` };
  if (code === 'ORPHAN_PAYMENT_RECONCILE') return { step: 1, kind: 'PAYMENT_ERROR', why: 'reason_code ORPHAN_PAYMENT_RECONCILE' };
  if (
    code === 'MEDUSA_REFUND' &&
    r.medusaNotes !== null &&
    r.medusaNotes.length > 0 &&
    r.medusaNotes.every((note) => MEDUSA_ITEM_CANCEL_NOTE.test(note))
  ) {
    return { step: 1, kind: 'ITEM_CANCEL', why: 'MEDUSA_REFUND with partial-cancel/channel-cancel notes' };
  }
  return null;
}

// 품절·부족·단종·누락만 있고 «취소»가 없으면 무엇을 되돌렸는지 단정 못 한다 — 걸린 것으로 세어 3단계로 보낸다.
const STOCK_WORDS = /품절|부족|단종|누락/;

function classifyByText(r: OldRefund): Verdict {
  const text = `${r.reasonCode ?? ''} ${r.reasonMessage ?? ''}`.trim();
  const hits: { kind: Kind | null; why: string }[] = [];
  if (STOCK_WORDS.test(text)) {
    hits.push(/취소/.test(text) ? { kind: 'ITEM_CANCEL', why: '품절·부족·단종·누락 + 취소' } : { kind: null, why: '재고 키워드만(취소 없음)' });
  }
  if (/차액|보상|배송비/.test(text)) hits.push({ kind: 'PRICE_ADJUSTMENT', why: '차액·보상·배송비' });
  if (/반품/.test(text)) hits.push({ kind: 'RETURN', why: '반품' });
  if (/중복\s?(결제|주문)/.test(text)) hits.push({ kind: 'PAYMENT_ERROR', why: '중복 결제·중복 주문' });

  if (hits.length === 0) return { step: 3, why: '걸리는 키워드 없음' };
  if (hits.length > 1) return { step: 3, why: `여러 규칙이 걸림: ${hits.map((h) => h.why).join(' / ')}` };
  const [only] = hits;
  if (only.kind === null) return { step: 3, why: only.why };
  return { step: 2, candidate: only.kind, why: only.why };
}

export function classifyOldRefund(r: OldRefund): Verdict {
  return classifyByCode(r) ?? classifyByText(r);
}
