import { CHANNEL_CAPABILITIES, getChannelFulfillmentCapabilities } from './channel-capabilities';

describe('CHANNEL_CAPABILITIES.reservation', () => {
  const reservationKind = (channel: 'medusa' | 'naver' | 'coupang') => {
    const caps = CHANNEL_CAPABILITIES[channel];
    if (caps.integration !== 'api') throw new Error('api 채널이어야 한다');
    return caps.reservation.kind;
  };

  it('medusa 는 projection, naver·coupang 은 none(설계상 비대상)', () => {
    expect(reservationKind('medusa')).toBe('projection');
    expect(reservationKind('naver')).toBe('none');
    expect(reservationKind('coupang')).toBe('none');
  });
});

describe('쿠팡 fulfillment', () => {
  it('쿠팡은 한 주문에 송장 여럿을 받지 않는다', () => {
    expect(getChannelFulfillmentCapabilities('coupang')?.multipleTrackingNumbers).toBe(false);
  });
});
