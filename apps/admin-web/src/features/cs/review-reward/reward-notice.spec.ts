import { describeEmptyGrants, rewardRuleNotice } from './shared';

/**
 * 이 화면의 존재 이유는 「지금 리뷰 보상이 나가는가」에 답하는 것이다.
 * 조회 실패를 「0건」으로 그리면 그 답이 거짓이 된다 — 실제로 403 인 화면이
 * 「지금은 아무 보상도 나가지 않습니다」를 크게 띄운 적이 있다.
 */
describe('rewardRuleNotice', () => {
  it('조회에 실패하면 활성 건수를 «세지 않는다»', () => {
    expect(rewardRuleNotice({ isError: true, rules: undefined })).toEqual({ kind: 'error' });
  });

  it('조회에 실패했다면 이전 목록이 남아 있어도 실패로 본다', () => {
    expect(rewardRuleNotice({ isError: true, rules: [{ active: true }] })).toEqual({ kind: 'error' });
  });

  it('아직 못 받았으면 0건이 아니라 로딩이다', () => {
    expect(rewardRuleNotice({ isError: false, rules: undefined })).toEqual({ kind: 'loading' });
  });

  it('빈 배열을 실제로 받았을 때만 0건이라고 말한다', () => {
    expect(rewardRuleNotice({ isError: false, rules: [] })).toEqual({ kind: 'counted', activeCount: 0 });
  });

  it('활성만 센다 — 비활성 규칙은 보상을 내보내지 않는다', () => {
    expect(rewardRuleNotice({ isError: false, rules: [{ active: true }, { active: false }] })).toEqual({
      kind: 'counted',
      activeCount: 1,
    });
  });
});

describe('describeEmptyGrants', () => {
  it('활성 규칙이 0건일 때만 「규칙이 없어서 안 쌓인다」고 설명한다', () => {
    expect(describeEmptyGrants(false)).toContain('활성 규칙이 없으면');
  });

  it('활성 규칙이 있으면 그 설명을 하지 않는다', () => {
    expect(describeEmptyGrants(true)).not.toContain('활성 규칙이 없으면');
  });

  it('규칙 목록을 아직/못 받았으면 원인을 단정하지 않는다', () => {
    expect(describeEmptyGrants(undefined)).toBe('');
  });
});
