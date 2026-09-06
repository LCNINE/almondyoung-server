import { buildWithdrawnCustomerUpdate, withdrawnEmailFor } from '../withdrawn-customer-fields';

const USER_ID = '3f9a1c2e-1111-4222-8333-444455556666';

describe('withdrawnEmailFor — user-service anonymizeIdentity 와 같은 규칙', () => {
  it("userId 의 '-' 를 지운 토큰으로 @deleted.invalid 주소를 만든다", () => {
    expect(withdrawnEmailFor(USER_ID)).toBe('withdrawn_3f9a1c2e111142228333444455556666@deleted.invalid');
  });
});

describe('buildWithdrawnCustomerUpdate — 식별정보만 지우고 행은 남긴다', () => {
  it('이름·전화·회사·이메일을 치환하고 almond_user_id 를 null 로, withdrawn_at 을 ISO 로 박는다', () => {
    const before = new Date('2026-09-07T00:00:00.000Z');
    const update = buildWithdrawnCustomerUpdate(USER_ID, { almond_user_id: USER_ID, almond_login_id: 'pauseb' }, before);

    expect(update).toEqual({
      email: 'withdrawn_3f9a1c2e111142228333444455556666@deleted.invalid',
      first_name: '탈퇴회원',
      last_name: null,
      phone: null,
      company_name: null,
      metadata: { almond_user_id: null, almond_login_id: 'pauseb', withdrawn_at: '2026-09-07T00:00:00.000Z' },
    });
  });

  it('metadata 가 null 이어도 almond_user_id: null 과 withdrawn_at 은 들어간다', () => {
    const update = buildWithdrawnCustomerUpdate(USER_ID, null, new Date('2026-09-07T00:00:00.000Z'));
    expect(update.metadata).toEqual({ almond_user_id: null, withdrawn_at: '2026-09-07T00:00:00.000Z' });
  });

  it('두 번 만들어도 같은 이메일이다 (재시도가 새 주소를 만들지 않는다)', () => {
    const a = buildWithdrawnCustomerUpdate(USER_ID, null, new Date());
    const b = buildWithdrawnCustomerUpdate(USER_ID, null, new Date());
    expect(a.email).toBe(b.email);
  });
});
