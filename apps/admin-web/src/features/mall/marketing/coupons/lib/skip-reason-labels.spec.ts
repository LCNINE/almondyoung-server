import { BACKEND_SKIP_REASONS, skipReasonLabel } from './skip-reason-labels';

describe('skipReasonLabel', () => {
  it('백엔드가 낼 수 있는 사유가 전부 라벨을 갖는다', () => {
    for (const reason of BACKEND_SKIP_REASONS) {
      expect(skipReasonLabel(reason)).not.toBe(skipReasonLabel('아무거나-없는-값'));
    }
  });

  it('분류표 밖 룰은 «그룹 불일치» 와 다른 문구다', () => {
    // 이 둘이 같은 문구면 어드민이 «고객을 그룹에 넣으면 되겠네» 로 오해한다.
    // 실제로 필요한 것은 발급 로직에 그 룰을 구현하는 것이다.
    expect(skipReasonLabel('unsupported_rule')).not.toBe(skipReasonLabel('group_mismatch'));
    expect(skipReasonLabel('unsupported_rule')).toContain('발급 조건');
  });

  it('모르는 값은 기본 문구로 떨어진다', () => {
    expect(skipReasonLabel('brand_new_reason')).toBe('발급할 수 없습니다.');
  });
});
