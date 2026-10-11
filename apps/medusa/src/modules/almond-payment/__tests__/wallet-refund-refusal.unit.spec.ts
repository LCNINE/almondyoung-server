import { MedusaError } from '@medusajs/framework/utils';
import {
  WalletHttpError,
  readWalletRefundRefusal,
  refusalFromWalletHttpError,
  walletRefundRefusedError,
} from '../wallet-refund-refusal';

describe('wallet 환불 오류 번역 (#1016 36번 재설계 §6.4)', () => {
  it('WalletHttpError 의 message 는 «코드: 문장» — 기존 includes 분기(INTENT_NOT_CANCELABLE 등)가 그대로 돈다', () => {
    expect(new WalletHttpError(400, 'INTENT_NOT_CANCELABLE', 'cannot be canceled').message).toBe('INTENT_NOT_CANCELABLE: cannot be canceled');
    expect(new WalletHttpError(500, undefined, 'Wallet API error 500: /x').message).toBe('Wallet API error 500: /x');
  });

  it('속성 이름이 code 가 아니다 — formatException 이 err.code 를 Postgres 코드로 읽는다', () => {
    expect('code' in new WalletHttpError(400, 'X', 'm', false)).toBe(false);
  });

  it('4xx + retryable false → NOT_ALLOWED, 표지 code, 문장은 wallet 원문', () => {
    const err = refusalFromWalletHttpError(new WalletHttpError(400, 'REFUND_NOT_AUTOMATABLE', '자동 환불할 수 없는 결제수단입니다', false));
    expect(err).toBeInstanceOf(MedusaError);
    expect(err?.type).toBe(MedusaError.Types.NOT_ALLOWED);
    expect(err?.code).toBe('wallet_refund_refused:REFUND_NOT_AUTOMATABLE');
    expect(err?.message).toBe('자동 환불할 수 없는 결제수단입니다');
  });

  it('404 도 본문이 영구라고 하면 영구 — REFUNDABLE_CHARGE_NOT_FOUND', () => {
    expect(refusalFromWalletHttpError(new WalletHttpError(404, 'REFUNDABLE_CHARGE_NOT_FOUND', 'm', false))?.code).toBe(
      'wallet_refund_refused:REFUNDABLE_CHARGE_NOT_FOUND',
    );
  });

  it.each<[string, unknown]>([
    ['retryable true(금액 초과류)', new WalletHttpError(400, 'REFUND_AMOUNT_EXCEEDS_TOTAL', 'm', true)],
    ['retryable 없음(ValidationPipe 400)', new WalletHttpError(400, 'Bad Request', 'm')],
    ['409 IDEMPOTENCY_KEY_IN_FLIGHT(retryable 없음)', new WalletHttpError(409, 'IDEMPOTENCY_KEY_IN_FLIGHT', 'm')],
    ['5xx 는 retryable false 가 실려도 일시', new WalletHttpError(502, 'X', 'm', false)],
    ['코드 없는 4xx', new WalletHttpError(400, undefined, 'm', false)],
    ['네트워크 오류', new TypeError('fetch failed')],
  ])('%s → null(그대로 던져 일시로 둔다)', (_, error) => {
    expect(refusalFromWalletHttpError(error)).toBeNull();
  });

  it('표지를 다시 읽는다 — 워크플로를 지나 평범한 객체가 된 오류에서도', () => {
    expect(readWalletRefundRefusal(walletRefundRefusedError('NOT_CANCELABLE_AMOUNT', '취소 할 수 없는 금액 입니다.'))).toEqual({
      code: 'NOT_CANCELABLE_AMOUNT',
      message: '취소 할 수 없는 금액 입니다.',
    });
    expect(readWalletRefundRefusal({ type: 'not_allowed', code: 'wallet_refund_refused:REFUND_NOT_AUTOMATABLE', message: 'm' })).toEqual({
      code: 'REFUND_NOT_AUTOMATABLE',
      message: 'm',
    });
  });

  it.each([undefined, null, 'x', new Error('PG down'), { code: 'partial_cancel_rejected' }, { code: 'wallet_refund_refused:' }, { code: 42 }])(
    '표지가 아니면 null(%p)',
    (error) => {
      expect(readWalletRefundRefusal(error)).toBeNull();
    },
  );
});
