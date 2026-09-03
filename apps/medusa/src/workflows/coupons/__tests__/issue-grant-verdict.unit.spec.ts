import { verdictOf } from '../steps/issue-grant-verdict';

// 라우트 넷이 제각각 읽던 tri-state({created, duplicated, exhausted})를 한 곳에서 접는다 (PR-2 결정 3).
describe('verdictOf', () => {
  it('만들었고 상한에 안 닿았으면 issued', () => expect(verdictOf(2, false)).toBe('issued'));
  it('만들다 상한에 닿았으면 partial — 라우트는 issued 와 max_claims_exceeded 둘 다 올린다', () =>
    expect(verdictOf(1, true)).toBe('partial'));
  it('하나도 못 만들고 상한이면 exhausted', () => expect(verdictOf(0, true)).toBe('exhausted'));
  it('하나도 안 만들고 상한도 아니면 전부 duplicate — already_issued', () =>
    expect(verdictOf(0, false)).toBe('already_issued'));
});
