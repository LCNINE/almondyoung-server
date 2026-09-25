/**
 * 시드가 만드는 관리자 계정(`user-service.seed-step.ts` Step 4)의 비밀번호를 정한다.
 *
 * 그 계정은 고정 id 행이 없을 때만 만들어지고 master 역할을 받는다. 기본값은 이 공개 저장소에
 * 적혀 있으므로, 운영에서 기본값으로 떨어지면 누구나 master 로 로그인할 수 있는 계정이 생긴다.
 * 역할만 추가하려고 참조 시드를 돌리는 경우가 실제로 있어서(#923), 운영에서는 거부한다.
 */
export const PUBLIC_DEFAULT_ADMIN_PASSWORD = 'Admin@1234!';

export function resolveAdminPassword(input: { entered?: string; envPassword?: string; isProd: boolean }): string {
  const entered = input.entered?.trim() ? input.entered : undefined;
  const resolved = entered ?? (input.envPassword || PUBLIC_DEFAULT_ADMIN_PASSWORD);
  if (input.isProd && resolved === PUBLIC_DEFAULT_ADMIN_PASSWORD) {
    throw new Error(
      '운영 stage 에서는 공개된 기본 관리자 비밀번호를 쓸 수 없다. ' +
        '대화형이면 강한 값을 입력하고, --yes 면 ADMIN_INITIAL_PASSWORD 를 준다 ' +
        '(고정 관리자 행이 이미 있으면 값은 쓰이지 않지만 그래도 요구한다).',
    );
  }
  return resolved;
}
