// apps/medusa/src/modules/almond-payment/__tests__/wallet-refund-refusal.unit.spec.ts
import { MedusaError } from '@medusajs/framework/utils';
import {
  WalletHttpError,
  classifyWalletRefundRefusal,
  readRefundFailureCode,
  walletRefundRefusalError,
} from '../wallet-refund-refusal';

describe('wallet 환불 거절 분류 (#1016 36번 스펙 §4.1)', () => {
  it.each([
    ['REFUND_NOT_AUTOMATABLE', 'refused'],
    ['MEMBERSHIP_REFUND_NOT_ALLOWED', 'refused'],
    ['REFUND_AMOUNT_EXCEEDS_TOTAL', 'ledger_mismatch'],
    ['REFUND_AMOUNT_EXCEEDS_AVAILABLE', 'ledger_mismatch'],
    ['REFUND_AMOUNT_EXCEEDS_CHARGE', 'ledger_mismatch'],
    ['CHARGE_NOT_REFUNDABLE', 'ledger_mismatch'],
    ['REFUNDABLE_CHARGE_NOT_FOUND', 'ledger_mismatch'],
  ])('%s → %s', (code, kind) => {
    expect(classifyWalletRefundRefusal(code)).toBe(kind);
  });

  it.each([undefined, '', 'PG_UNAVAILABLE', 'VALIDATION_ERROR', 'INTENT_NOT_FOUND', 'NOT_FOUND', 'toString'])(
    '그 밖(%p)은 분류 없음 — 일시 실패로 재시도한다',
    (code) => {
      expect(classifyWalletRefundRefusal(code)).toBeNull();
    },
  );

  it('표지 오류 — NOT_ALLOWED, code 에 갈래·wallet 코드, 문장에 wallet 원문', () => {
    const err = walletRefundRefusalError('ledger_mismatch', 'REFUND_AMOUNT_EXCEEDS_TOTAL', 'Refund amount (3000) exceeds remaining (0)');
    expect(err).toBeInstanceOf(MedusaError);
    expect(err.type).toBe(MedusaError.Types.NOT_ALLOWED);
    expect(err.code).toBe('wallet_refund_ledger_mismatch:REFUND_AMOUNT_EXCEEDS_TOTAL');
    expect(err.message).toContain('다시 환불하지 말고');
    expect(err.message).toContain('REFUND_AMOUNT_EXCEEDS_TOTAL: Refund amount (3000) exceeds remaining (0)');
    expect(walletRefundRefusalError('refused', 'REFUND_NOT_AUTOMATABLE', 'm').message).toContain('다른 수단으로 환불');
  });

  it('직렬화된 오류(평범한 객체)의 code 에서 표지를 다시 읽는다 — 부분취소가 쓴다', () => {
    expect(readRefundFailureCode({ message: 'x', code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE' })).toEqual({
      kind: 'refused',
      walletCode: 'REFUND_NOT_AUTOMATABLE',
    });
    expect(readRefundFailureCode(walletRefundRefusalError('ledger_mismatch', 'REFUND_AMOUNT_EXCEEDS_TOTAL', 'm'))).toEqual({
      kind: 'ledger_mismatch',
      walletCode: 'REFUND_AMOUNT_EXCEEDS_TOTAL',
    });
    expect(readRefundFailureCode({ code: 'wallet_refund_other:X' })).toBeNull();
    expect(readRefundFailureCode(new Error('PG down'))).toBeNull();
    expect(readRefundFailureCode(undefined)).toBeNull();
  });

  it('WalletHttpError 의 message 는 «코드: 문장» — 기존 includes 분기(INTENT_NOT_CANCELABLE 등)가 그대로 돈다', () => {
    expect(new WalletHttpError(400, 'INTENT_NOT_CANCELABLE', 'cannot be canceled').message).toBe('INTENT_NOT_CANCELABLE: cannot be canceled');
    expect(new WalletHttpError(500, undefined, 'Wallet API error 500: /x').message).toBe('Wallet API error 500: /x');
  });
});
