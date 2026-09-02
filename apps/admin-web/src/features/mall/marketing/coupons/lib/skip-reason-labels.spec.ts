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

  it('link_error 는 «발급됨» 을, grant_error 는 «발급 실패» 를 말한다 — 두 상태는 반대다', () => {
    // 🔴 옛 문구는 둘이 **글자까지 같았다**(둘 다 「발급 처리 중 오류가 발생했습니다」).
    // 그런데 `link_error` 는 grant 가 **이미 만들어진 뒤** 표시용 링크만 실패한 경우라
    // 쿠폰은 발급된 상태다. 관리자는 그걸 실패로 읽었다.
    // 위 「전부 라벨을 갖는다」 검사는 두 값이 같은 문구여도 통과하므로 이 결함을 못 잡는다.
    expect(skipReasonLabel('link_error')).not.toBe(skipReasonLabel('grant_error'));
    expect(skipReasonLabel('link_error')).toContain('발급됐');
  });

  it('public_promotion 은 «왜» 를 말한다 — 관리자가 재시도로 뚫으려 하지 않게', () => {
    expect(skipReasonLabel('public_promotion')).toContain('공개 쿠폰');
    expect(skipReasonLabel('public_promotion')).not.toContain('다시 시도');
  });

  it('모르는 값은 기본 문구로 떨어진다', () => {
    expect(skipReasonLabel('brand_new_reason')).toBe('발급할 수 없습니다.');
  });
});
