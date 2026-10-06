export interface PaymentPreference {
  method: '신용·체크카드' | '카카오페이' | '네이버페이' | '토스페이' | 'BRANDPAY';
  cardCompany?: string;
}

const methods = ['신용·체크카드', '카카오페이', '네이버페이', '토스페이', 'BRANDPAY'];
const companies = ['41', '61', '51', '71', '24', '21', '11', '31', '91', '33', '15', '35', '46', '3K', '34', '37'];

export function parsePaymentPreference(raw: string | null): PaymentPreference | null {
  try {
    const value: unknown = JSON.parse(raw ?? 'null');
    if (
      !value ||
      typeof value !== 'object' ||
      !('method' in value) ||
      typeof value.method !== 'string' ||
      !methods.includes(value.method)
    )
      return null;
    const method = value.method as PaymentPreference['method'];
    const company = 'cardCompany' in value ? value.cardCompany : undefined;
    if (method === '신용·체크카드' && (typeof company !== 'string' || !companies.includes(company))) return null;
    return { method, ...(method === '신용·체크카드' ? { cardCompany: company as string } : {}) };
  } catch {
    return null;
  }
}

export function readPaymentPreference(customerKey: string): PaymentPreference | null {
  try {
    return parsePaymentPreference(localStorage.getItem(`wallet:payment-preference:${customerKey}`));
  } catch {
    return null;
  }
}

/** 인증 이동 전 임시 저장. 성공이 확인되기 전에는 이전 결제 설정을 덮어쓰지 않는다. */
export function stagePaymentPreference(intentId: string, customerKey: string, preference: PaymentPreference) {
  try {
    const valid = parsePaymentPreference(JSON.stringify(preference));
    if (valid)
      sessionStorage.setItem(`wallet:pending-payment:${intentId}`, JSON.stringify({ customerKey, preference: valid }));
  } catch {
    // 저장소 사용 불가가 결제를 막지 않도록 한다.
  }
}

/** 서버에서 결제 승인이 성공한 뒤에만 호출한다. 카드 번호·약관·할부·포인트는 저장하지 않는다. */
export function completePaymentPreference(intentId: string) {
  try {
    const key = `wallet:pending-payment:${intentId}`;
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    const pending = JSON.parse(raw) as { customerKey?: unknown; preference?: unknown };
    const preference = parsePaymentPreference(JSON.stringify(pending.preference));
    if (typeof pending.customerKey === 'string' && preference) {
      localStorage.setItem(`wallet:payment-preference:${pending.customerKey}`, JSON.stringify(preference));
    }
    sessionStorage.removeItem(key);
  } catch {
    // 결제 성공 리다이렉트는 저장 실패와 관계없이 진행한다.
  }
}
