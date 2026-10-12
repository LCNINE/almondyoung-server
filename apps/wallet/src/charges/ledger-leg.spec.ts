import { ledgerLegChargeId } from './ledger-leg';

describe('ledgerLegChargeId — provider 원장이 이 결제분을 어떤 id 로 알고 있나', () => {
  it('확정(CAPTURE) 결제분은 requestPayload.authorizeChargeId(승인 결제분 id)', () => {
    expect(
      ledgerLegChargeId({ id: 'cap-1', operation: 'CAPTURE', requestPayload: { intentId: 'i-1', authorizeChargeId: 'auth-1' } }),
    ).toBe('auth-1');
  });

  it('확정 결제분인데 authorizeChargeId 가 없으면(2026-02-25 이전 코드) 자기 id', () => {
    expect(ledgerLegChargeId({ id: 'cap-1', operation: 'CAPTURE', requestPayload: { intentId: 'i-1' } })).toBe('cap-1');
    expect(ledgerLegChargeId({ id: 'cap-1', operation: 'CAPTURE', requestPayload: null })).toBe('cap-1');
  });

  it('authorizeChargeId 가 문자열이 아니거나 빈 문자열이면 자기 id', () => {
    expect(ledgerLegChargeId({ id: 'cap-1', operation: 'CAPTURE', requestPayload: { authorizeChargeId: 42 } })).toBe('cap-1');
    expect(ledgerLegChargeId({ id: 'cap-1', operation: 'CAPTURE', requestPayload: { authorizeChargeId: '' } })).toBe('cap-1');
  });

  it('승인(AUTHORIZE) 결제분은 자기 id — 확정 없이 1순위가 비어 내려온 경우', () => {
    expect(
      ledgerLegChargeId({ id: 'auth-1', operation: 'AUTHORIZE', requestPayload: { authorizeChargeId: 'other' } }),
    ).toBe('auth-1');
  });
});
