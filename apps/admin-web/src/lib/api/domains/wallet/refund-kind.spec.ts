import {
  REFUND_KINDS,
  REFUND_KIND_FILTER_OPTIONS,
  refundFormError,
  refundKindLabel,
  stateTransitionLabel,
} from './refund-kind';

describe('refundKindLabel', () => {
  it('다섯 종류는 화면 이름, null·모르는 값은 «모름»', () => {
    expect(REFUND_KINDS.map(refundKindLabel)).toEqual(['품목 취소', '반품', '금액 조정', '구독료 환불', '결제 오류']);
    expect(refundKindLabel(null)).toBe('모름');
    expect(refundKindLabel('MEDUSA_REFUND')).toBe('모름');
  });
});

describe('REFUND_KIND_FILTER_OPTIONS', () => {
  it('다섯 + 마지막은 UNKNOWN', () => {
    expect(REFUND_KIND_FILTER_OPTIONS).toHaveLength(6);
    expect(REFUND_KIND_FILTER_OPTIONS[5]).toEqual({ label: '모름', value: 'UNKNOWN' });
  });
});

describe('refundFormError', () => {
  it('종류 미선택이면 막는다', () => {
    expect(refundFormError({ kind: '', amount: 1000 })).toBe('환불 종류를 골라 주세요');
  });
  it('금액이 없거나 1 미만이면 막는다', () => {
    expect(refundFormError({ kind: 'RETURN', amount: '' })).not.toBeNull();
    expect(refundFormError({ kind: 'RETURN', amount: 0 })).not.toBeNull();
  });
  it('둘 다 있으면 통과', () => {
    expect(refundFormError({ kind: 'RETURN', amount: 1000 })).toBeNull();
  });
});

describe('stateTransitionLabel', () => {
  const base = { previousStatus: 'SUCCEEDED', newStatus: 'SUCCEEDED' };
  it('KIND_CHANGED 는 «종류 변경: 이전 → 이후»', () => {
    expect(
      stateTransitionLabel({ ...base, reasonCode: 'KIND_CHANGED', payload: { fromKind: null, toKind: 'PRICE_ADJUSTMENT' } }),
    ).toBe('종류 변경: 모름 → 금액 조정');
    expect(
      stateTransitionLabel({ ...base, reasonCode: 'KIND_CHANGED', payload: { fromKind: 'RETURN', toKind: null } }),
    ).toBe('종류 변경: 반품 → 모름');
  });
  it('payload 가 없어도 KIND_CHANGED 면 모름으로 채운다', () => {
    expect(stateTransitionLabel({ ...base, reasonCode: 'KIND_CHANGED', payload: null })).toBe('종류 변경: 모름 → 모름');
  });
  it('그 밖은 null', () => {
    expect(stateTransitionLabel({ ...base, reasonCode: null, payload: null })).toBeNull();
    expect(stateTransitionLabel({ ...base, reasonCode: undefined })).toBeNull();
  });
});
