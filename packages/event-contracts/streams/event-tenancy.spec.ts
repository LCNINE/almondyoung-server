import { ACCOUNT_EVENTS, eventTenancy } from './registry';

/**
 * 이벤트마다 «테넌트 이벤트»(기본)인지 «계정 이벤트»인지 계약이 선언한다.
 * 소비 앱의 문은 계정 이벤트를 테넌트와 상관없이 통과시킨다 — 계정은 테넌트로 쪼개지지 않고,
 * 탈퇴·휴면·영구 삭제는 그 계정을 들고 있는 모든 테넌트의 서비스가 들어야 한다.
 */
describe('이벤트의 테넌트 성격', () => {
  it('계정 이벤트는 users.events.v1 의 계정 수명주기 셋과 프로필 수정이다', () => {
    expect(ACCOUNT_EVENTS).toEqual([
      { topic: 'users.events.v1', messageType: 'UserUpdated' },
      { topic: 'users.events.v1', messageType: 'UserDeleted' },
      { topic: 'users.events.v1', messageType: 'UserDormantConverted' },
      { topic: 'users.events.v1', messageType: 'UserPermanentDeleted' },
    ]);
  });

  it('선언한 계정 이벤트는 account 다', () => {
    expect(eventTenancy('users.events.v1', 'UserPermanentDeleted')).toBe('account');
  });

  it('프로필 수정(UserUpdated)은 계정 이벤트다 — 이메일·프로필은 계정 전역이고, 테넌트 2 셸에서 고쳐도 아몬드영 Medusa 고객이 따라가야 한다', () => {
    expect(eventTenancy('users.events.v1', 'UserUpdated')).toBe('account');
  });

  it('비밀번호 변경(UserPasswordChanged)은 테넌트 이벤트다 — 알림 메일은 그 일이 일어난 화면의 브랜드다', () => {
    expect(eventTenancy('users.events.v1', 'UserPasswordChanged')).toBe('tenant');
  });

  it('고객 가입(UserCreated)은 들어온 앱의 테넌트에 일어나므로 테넌트 이벤트다', () => {
    expect(eventTenancy('users.events.v1', 'UserCreated')).toBe('tenant');
  });

  it('선언이 없으면 테넌트 이벤트다 — 접속기록(PiiAccessed)도 그렇다', () => {
    expect(eventTenancy('iam.events.v1', 'PiiAccessed')).toBe('tenant');
    expect(eventTenancy('products.events.v1', 'ProductVariantCreated')).toBe('tenant');
  });

  it('모르는 토픽·이벤트도 테넌트 이벤트다 — 문을 통과하는 쪽으로 기울지 않는다', () => {
    expect(eventTenancy('nope.events.v1', 'Whatever')).toBe('tenant');
    expect(eventTenancy('users.events.v1', 'NotDeclared')).toBe('tenant');
  });
});
