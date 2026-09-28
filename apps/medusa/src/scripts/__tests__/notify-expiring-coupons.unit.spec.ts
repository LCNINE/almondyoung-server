import { groupNotices, notifyExpiringCoupons } from '../notify-expiring-coupons';

describe('다운로드 쿠폰 만료 예정 안내', () => {
  const expires = new Date('2026-09-25T00:00:00.000Z');

  it('회원별로 쿠폰을 묶고, 회원 id 가 없는 고객은 뺀다', () => {
    const notices = groupNotices(
      [
        { id: 'g1', customer_id: 'cus_1', promotion_id: 'promo_a', expires_at: expires },
        { id: 'g2', customer_id: 'cus_1', promotion_id: 'promo_b', expires_at: expires },
        { id: 'g3', customer_id: 'cus_2', promotion_id: 'promo_a', expires_at: expires },
      ],
      new Map([['cus_1', 'user-1']]),
      new Map([['promo_a', '가을 10% 쿠폰']]),
    );

    expect(notices).toEqual([
      {
        userId: 'user-1',
        coupons: [
          { name: '가을 10% 쿠폰', expiresAt: expires.toISOString() },
          { name: '쿠폰', expiresAt: expires.toISOString() },
        ],
        grantIds: ['g1', 'g2'],
      },
    ]);
  });


  it('알림 서비스 설정이 없으면 쿠폰을 선점하지 않고 건너뛴다', async () => {
    const claim = jest.fn();
    const container = {
      resolve: jest.fn((key: string) =>
        key === 'logger' ? { warn: jest.fn(), info: jest.fn() } : { claimExpiringGrants: claim },
      ),
    };
    const saved = { url: process.env.NOTIFICATION_SERVICE_URL, key: process.env.NOTIFICATION_INTERNAL_KEY };
    delete process.env.NOTIFICATION_SERVICE_URL;
    delete process.env.NOTIFICATION_INTERNAL_KEY;

    await notifyExpiringCoupons(container as never);

    expect(claim).not.toHaveBeenCalled();
    process.env.NOTIFICATION_SERVICE_URL = saved.url;
    process.env.NOTIFICATION_INTERNAL_KEY = saved.key;
  });
});
