import { PUBLIC_DEFAULT_ADMIN_PASSWORD, resolveAdminPassword } from './admin-password';

describe('resolveAdminPassword', () => {
  it('입력값이 있으면 그것을 쓴다', () => {
    expect(resolveAdminPassword({ entered: 'typed-Strong#1', envPassword: 'env-Strong#1', isProd: true })).toBe(
      'typed-Strong#1',
    );
  });

  it('입력이 비면 환경변수로 폴백한다', () => {
    expect(resolveAdminPassword({ entered: '  ', envPassword: 'env-Strong#1', isProd: true })).toBe('env-Strong#1');
  });

  it('비운영 stage 에서는 공개 기본값을 허용한다', () => {
    expect(resolveAdminPassword({ isProd: false })).toBe(PUBLIC_DEFAULT_ADMIN_PASSWORD);
  });

  // 참조 시드는 고정 id 관리자 행이 없으면 그 비밀번호로 master 계정을 만든다.
  // 기본값은 이 공개 저장소에 적혀 있으므로 운영에서 쓰이면 누구나 master 로 로그인한다.
  it('운영 stage 에서 공개 기본값으로 떨어지면 거부한다', () => {
    expect(() => resolveAdminPassword({ isProd: true })).toThrow(/ADMIN_INITIAL_PASSWORD/);
    expect(() => resolveAdminPassword({ entered: '', envPassword: '', isProd: true })).toThrow();
  });

  it('운영 stage 에서 공개 기본값을 직접 입력해도 거부한다', () => {
    expect(() => resolveAdminPassword({ entered: PUBLIC_DEFAULT_ADMIN_PASSWORD, isProd: true })).toThrow();
    expect(() => resolveAdminPassword({ envPassword: PUBLIC_DEFAULT_ADMIN_PASSWORD, isProd: true })).toThrow();
  });
});
