import { refundRefusal } from './refund-refusal';

describe('refundRefusal — wallet 이 환불 요청을 거절할 때의 본문', () => {
  it('금액 초과류는 retryable=true — 호출자 장부와 wallet 이 어긋난 경합이다(맞춘 뒤 다시 보낸다)', () => {
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_CHARGE', 'm').retryable).toBe(true);
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_AVAILABLE', 'm').retryable).toBe(true);
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_TOTAL', 'm').retryable).toBe(true);
  });

  it('수단·정책·데이터가 막는 거절은 retryable=false', () => {
    for (const code of [
      'REFUND_NOT_AUTOMATABLE',
      'MEMBERSHIP_REFUND_NOT_ALLOWED',
      'CHARGE_NOT_FOUND',
      'CHARGE_INTENT_MISMATCH',
      'CHARGE_NOT_REFUNDABLE',
      'PAYMENT_METHOD_NOT_FOUND',
      'INTENT_NOT_FOUND',
      'REFUNDABLE_CHARGE_NOT_FOUND',
    ] as const) {
      expect(refundRefusal(code, 'm').retryable).toBe(false);
    }
  });

  it('core WalletRefundClient 가 읽는 모양 그대로: error 는 코드 문자열, message 는 문자열', () => {
    // core 는 body.error 가 REFUND_AMOUNT_EXCEEDS_AVAILABLE·_TOTAL 이면 already_refunded 로 읽는다 — 이 두 이름이 바뀌면 안 된다
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_AVAILABLE', 'Refund amount (5000) exceeds available (2000)')).toEqual({
      error: 'REFUND_AMOUNT_EXCEEDS_AVAILABLE',
      message: '환불 금액이 환불할 수 있는 남은 금액보다 큽니다.',
      detail: 'Refund amount (5000) exceeds available (2000)',
      retryable: true,
    });
    expect(refundRefusal('REFUND_AMOUNT_EXCEEDS_TOTAL', 'x').error).toBe('REFUND_AMOUNT_EXCEEDS_TOTAL');
  });

  it('message 는 운영자가 읽는 한국어 문장이다 — Medusa·core 가 그대로 정산 사유로 보인다. 개발용 문장(결제분 id 등)은 detail 로', () => {
    for (const code of [
      'REFUND_AMOUNT_EXCEEDS_CHARGE',
      'REFUND_AMOUNT_EXCEEDS_AVAILABLE',
      'REFUND_AMOUNT_EXCEEDS_TOTAL',
      'REFUND_NOT_AUTOMATABLE',
      'MEMBERSHIP_REFUND_NOT_ALLOWED',
      'CHARGE_NOT_FOUND',
      'CHARGE_INTENT_MISMATCH',
      'CHARGE_NOT_REFUNDABLE',
      'PAYMENT_METHOD_NOT_FOUND',
      'INTENT_NOT_FOUND',
      'REFUNDABLE_CHARGE_NOT_FOUND',
    ] as const) {
      const body = refundRefusal(code, 'Charge c-1 detail');
      expect(body.message).toMatch(/[가-힣]/);
      expect(body.message).not.toContain('c-1');
      expect(body.detail).toBe('Charge c-1 detail');
    }
    expect(refundRefusal('REFUND_NOT_AUTOMATABLE', 'x').message).toBe(
      '자동으로 환불할 수 없는 결제수단입니다. 고객에게 계좌를 받아 송금으로 환불해 주세요.',
    );
  });

  it('응답 끊긴 이전 환불을 확인한 뒤의 거절 — 장부를 다시 맞추면 되므로 일시', () => {
    expect(refundRefusal('AMBIGUOUS_REFUND_RESOLVED', 'charge c-1 refund r-1 resolved SUCCEEDED')).toEqual({
      error: 'AMBIGUOUS_REFUND_RESOLVED',
      message: '이전 환불 요청의 결과를 확인했습니다. 환불 금액을 다시 계산해 주세요.',
      detail: 'charge c-1 refund r-1 resolved SUCCEEDED',
      retryable: true,
    });
  });

  it('무통장 응답 끊긴 환불을 다시 보낼 계좌가 없다 — 영구(운영자가 토스 상점관리자에서 확인)', () => {
    expect(refundRefusal('AMBIGUOUS_REFUND_NEEDS_ACCOUNT', 'x').retryable).toBe(false);
  });

  it('다시 보냈는데 또 끊겼다 — 결과를 아직 모르니 일시', () => {
    expect(refundRefusal('AMBIGUOUS_REFUND_UNRESOLVED', 'x')).toMatchObject({
      message: '이전 환불 요청의 결과를 아직 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
      retryable: true,
    });
  });
});
