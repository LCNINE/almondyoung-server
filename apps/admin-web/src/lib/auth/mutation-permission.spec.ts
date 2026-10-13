import { requirementKeys, requirementMessage, requirementMet } from './mutation-permission';

const held = new Set(['payment.refund.execute', 'messaging.message.read']);

describe('requirementMet', () => {
  it('needs any one of a plain list', () => {
    expect(requirementMet(held, ['order.order.cancel', 'payment.refund.execute'])).toBe(true);
    expect(requirementMet(held, ['order.order.cancel'])).toBe(false);
  });

  it('needs every group of an allOf requirement', () => {
    const both = { allOf: [['payment.refund.execute'], ['order.order.cancel']] };
    expect(requirementMet(held, both)).toBe(false);
    expect(requirementMet(new Set([...held, 'order.order.cancel']), both)).toBe(true);
  });

  it('lets anyone signed in run a self-service action', () => {
    expect(requirementMet(new Set(), 'self')).toBe(true);
  });
});

describe('requirementMessage', () => {
  it('names the alternatives, or every required permission for an allOf requirement', () => {
    expect(requirementMessage(['order.order.cancel'])).toBe('이 작업에는 주문 취소 권한이 필요합니다.');
    expect(requirementMessage({ allOf: [['payment.refund.execute'], ['order.order.cancel']] })).toBe(
      '이 작업에는 환불 실행, 주문 취소 권한이 모두 필요합니다.',
    );
  });

  it('lists the keys of a requirement', () => {
    expect(requirementKeys({ allOf: [['payment.refund.execute'], ['order.order.cancel']] })).toEqual([
      'payment.refund.execute',
      'order.order.cancel',
    ]);
    expect(requirementKeys('self')).toEqual([]);
  });
});
