import {
  decideCompletion,
  parseAdminRefundAmount,
} from './admin-refund-amount';

describe('admin refund amount', () => {
  it('automatic quote completes now', () => {
    expect(decideCompletion({ kind: 'automatic', amount: 5000 }, false)).toEqual(
      { kind: 'complete_now' }
    );
  });

  it('admin amount asks for the amount', () => {
    expect(decideCompletion({ kind: 'admin_amount', cap: 2000 }, true)).toEqual({
      kind: 'ask_amount',
      cap: 2000,
    });
  });

  it('admin amount without refund permission is blocked', () => {
    expect(decideCompletion({ kind: 'admin_amount', cap: 2000 }, false)).toEqual({
      kind: 'blocked',
      message: '세트 구성품 일부 반품은 환불 실행 권한이 있어야 완료할 수 있습니다.',
    });
  });

  it('parses an integer within the cap', () => {
    expect(parseAdminRefundAmount('1200', 2000)).toEqual({ ok: true, amount: 1200 });
    expect(parseAdminRefundAmount(' 0 ', 2000)).toEqual({ ok: true, amount: 0 });
  });

  it('rejects non-integers', () => {
    for (const input of ['', '12.5', '-1', '1,200']) {
      expect(parseAdminRefundAmount(input, 2000)).toEqual({
        ok: false,
        message: '환불 금액을 0 이상의 정수로 입력하세요.',
      });
    }
  });

  it('rejects over the cap', () => {
    expect(parseAdminRefundAmount('2001', 2000)).toEqual({
      ok: false,
      message: '상한 2000원을 넘을 수 없습니다.',
    });
  });
});
