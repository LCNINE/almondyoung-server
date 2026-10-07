import { channelCancelRoute, sellerCenterMessage } from './channel-cancel-route';

describe('channelCancelRoute (#1016 35번, 스펙 §5.2)', () => {
  it.each([
    ['medusa', 'command'],
    ['naver', 'seller_center'],
    ['coupang', 'seller_center'],
    ['3pl', 'core'],
    ['cafe24', 'core'],
  ])('%s → %s', (channel, route) => expect(channelCancelRoute(channel)).toBe(route));

  it('판매자센터 문구', () => {
    expect(sellerCenterMessage('naver')).toBe('네이버 판매자센터에서 취소해 주세요.');
    expect(sellerCenterMessage('coupang')).toBe('쿠팡 판매자센터에서 취소해 주세요.');
  });
});
