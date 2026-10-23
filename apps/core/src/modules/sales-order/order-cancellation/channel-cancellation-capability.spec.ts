import { cancellationCapabilityOf, channelsWhere, sellerCenterMessage } from './channel-cancellation-capability';

describe('channel-cancellation-capability (K7 PR1)', () => {
  it.each([
    [
      'medusa',
      {
        cancel: 'command',
        settlesMoney: 'channel',
        acceptsAlreadyRefundedOffset: true,
        customerSelfCancel: true,
        cancelledByWalletRefundApproval: true,
        sellerCenterLabel: null,
      },
    ],
    [
      'naver',
      {
        cancel: 'seller_center',
        settlesMoney: 'channel',
        acceptsAlreadyRefundedOffset: false,
        customerSelfCancel: false,
        cancelledByWalletRefundApproval: false,
        sellerCenterLabel: '네이버',
      },
    ],
    [
      'coupang',
      {
        cancel: 'seller_center',
        settlesMoney: 'channel',
        acceptsAlreadyRefundedOffset: false,
        customerSelfCancel: false,
        cancelledByWalletRefundApproval: false,
        sellerCenterLabel: '쿠팡',
      },
    ],
    [
      '3pl',
      {
        cancel: 'core',
        settlesMoney: 'core',
        acceptsAlreadyRefundedOffset: false,
        customerSelfCancel: false,
        cancelledByWalletRefundApproval: false,
        sellerCenterLabel: null,
      },
    ],
  ])('%s', (ch, cap) => expect(cancellationCapabilityOf(ch)).toEqual(cap));

  it('표에 없는 채널은 core 로 떨어지지 않고 던진다 (D8)', () =>
    expect(() => cancellationCapabilityOf('cafe24')).toThrow('Unknown sales channel for cancellation: cafe24'));

  it('판매자센터 문구', () => {
    expect(sellerCenterMessage('naver')).toBe('네이버 판매자센터에서 취소해 주세요.');
    expect(sellerCenterMessage('coupang')).toBe('쿠팡 판매자센터에서 취소해 주세요.');
  });

  it('wallet intent 로 결제되는 채널', () =>
    expect(channelsWhere((c) => c.cancelledByWalletRefundApproval)).toEqual(['medusa']));
});
