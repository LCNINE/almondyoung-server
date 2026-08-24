export type EvidenceType = 'NONE' | 'CASH_INCOME' | 'CASH_EXPENSE';
export type CashReceiptMethod = 'PHONE' | 'CARD';

export interface CashReceiptState {
  evidenceType: EvidenceType;
  /** 소득공제 발급방법: 휴대폰 or 현금영수증카드 (토스 customerIdentityNumber 는 둘 다 허용) */
  method: CashReceiptMethod;
  number: string;
  saveForNextTime: boolean;
}

export const EMPTY_CASH_RECEIPT: CashReceiptState = {
  evidenceType: 'NONE',
  method: 'PHONE',
  number: '',
  saveForNextTime: false,
};

export interface CashReceiptPayload {
  type: '소득공제' | '지출증빙';
  customerIdentityNumber: string;
}

export type CashReceiptResult =
  | { ok: true; cashReceipt?: CashReceiptPayload; offerSaveBizNumber: boolean }
  | { ok: false; error: string };

/**
 * 증빙 입력값을 wallet confirm 페이로드로 변환한다. 실패 사유는 화면에 그대로 띄우는 문구.
 * 부수효과 없음 — 사업자번호 저장 제안 여부는 offerSaveBizNumber 로 알려주고 호출부가 결정한다.
 */
export function buildCashReceipt(state: CashReceiptState, userBizNumber: string): CashReceiptResult {
  const digits = state.number.replace(/[^0-9]/g, '');

  if (state.evidenceType === 'CASH_INCOME') {
    if (state.method === 'PHONE' && (digits.length < 10 || digits.length > 11)) {
      return { ok: false, error: '휴대폰번호를 정확히 입력해주세요.' };
    }
    if (state.method === 'CARD' && (digits.length < 13 || digits.length > 19)) {
      return { ok: false, error: '현금영수증 카드번호를 정확히 입력해주세요.' };
    }
    return { ok: true, cashReceipt: { type: '소득공제', customerIdentityNumber: digits }, offerSaveBizNumber: false };
  }

  if (state.evidenceType === 'CASH_EXPENSE') {
    if (digits.length !== 10) {
      return { ok: false, error: '사업자등록번호를 정확히 입력해주세요 (10자리).' };
    }
    return {
      ok: true,
      cashReceipt: { type: '지출증빙', customerIdentityNumber: digits },
      offerSaveBizNumber: !userBizNumber && state.saveForNextTime,
    };
  }

  return { ok: true, offerSaveBizNumber: false };
}

const PREFERENCE_KEY = 'cash-receipt-preference';

export interface CashReceiptPreference {
  evidenceType: Exclude<EvidenceType, 'NONE'>;
  method: CashReceiptMethod;
  number: string;
}

export function readCashReceiptPreference(): CashReceiptPreference | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PREFERENCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CashReceiptPreference>;
    if (!parsed.number || !parsed.evidenceType || !parsed.method) return null;
    return { evidenceType: parsed.evidenceType, method: parsed.method, number: parsed.number };
  } catch {
    return null;
  }
}

export function saveCashReceiptPreference(state: CashReceiptState): void {
  if (typeof window === 'undefined') return;
  try {
    if (state.evidenceType === 'NONE' || !state.saveForNextTime) {
      window.localStorage.removeItem(PREFERENCE_KEY);
      return;
    }
    const preference: CashReceiptPreference = {
      evidenceType: state.evidenceType,
      method: state.method,
      number: state.number.replace(/[^0-9]/g, ''),
    };
    window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify(preference));
  } catch {
    // localStorage 접근이 차단된 환경(사파리 프라이빗/인앱웹뷰 등). 저장은 편의 기능이라 생략한다.
  }
}
