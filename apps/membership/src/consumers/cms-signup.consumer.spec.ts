import { CmsSignupConsumer } from './cms-signup.consumer';
import { ActiveSubscriptionExistsException } from '../shared/exceptions/subscription.exceptions';

describe('CmsSignupConsumer', () => {
  const resumeCmsSignup = jest.fn().mockResolvedValue(false);
  beforeEach(() => resumeCmsSignup.mockClear());

  const payload = {
    cmsAgreementId: 'agr-1',
    billingMethodId: 'bm-1',
    userId: 'u1',
    planId: 'p1',
    termsAgreementId: 'terms-1',
    occurredAt: '2026-10-26T00:00:00.000Z',
  };

  function make(
    subscribe: jest.Mock,
    findContacts = jest.fn().mockResolvedValue(new Map([['u1', { email: 'a@b.c' }]])),
  ) {
    return new CmsSignupConsumer(
      { subscribeWithBillingMethod: subscribe, resumeCmsSignup } as never,
      { findContacts } as never,
    );
  }

  it('그 계좌로 정기 가입을 만든다', async () => {
    const subscribe = jest.fn().mockResolvedValue({});
    await make(subscribe).onCmsSignupRequested(payload);
    expect(subscribe).toHaveBeenCalledWith('u1', 'p1', 'a@b.c', 'bm-1', 'recurring', undefined, 'terms-1');
  });

  it('이미 가입돼 있으면 끊긴 단계를 이어 보고 성공으로 넘긴다 — 재배달이나 고객이 먼저 가입한 경우', async () => {
    const subscribe = jest.fn().mockRejectedValue(new ActiveSubscriptionExistsException());
    await expect(make(subscribe).onCmsSignupRequested(payload)).resolves.toBeUndefined();
    expect(resumeCmsSignup).toHaveBeenCalledWith('u1', 'bm-1', 'terms-1', new Date(payload.occurredAt));
  });

  it('그 밖의 거절은 던져서 재시도·DLQ 로 보낸다', async () => {
    const subscribe = jest.fn().mockRejectedValue(new Error('arrears'));
    await expect(make(subscribe).onCmsSignupRequested(payload)).rejects.toThrow('arrears');
  });

  it('연락처 조회가 실패해도 가입은 만든다', async () => {
    const subscribe = jest.fn().mockResolvedValue({});
    await make(subscribe, jest.fn().mockRejectedValue(new Error('down'))).onCmsSignupRequested(payload);
    expect(subscribe).toHaveBeenCalledWith('u1', 'p1', '', 'bm-1', 'recurring', undefined, 'terms-1');
  });
});
