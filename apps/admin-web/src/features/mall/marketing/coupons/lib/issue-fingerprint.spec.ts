import { issueFingerprint } from './issue-fingerprint';

describe('issueFingerprint', () => {
  it('같은 대상·수량이면 같은 지문이다 — 재조회해도 제출 키를 재사용할 수 있다', () => {
    expect(issueFingerprint(['cus_a', 'cus_b'], 3)).toBe(issueFingerprint(['cus_a', 'cus_b'], 3));
  });

  it('대상 순서는 지문을 바꾸지 않는다', () => {
    // 발급 키는 `${submitId}:${n}` 이고 유니크는 (프로모션, 고객, 키) 삼중이라 고객마다
    // 독립이다 — 즉 «집합» 이 같으면 같은 제출이다. 조회 순서로 키를 버리면 아래 「수량이
    // 바뀌면」 검사만 남기고 재시도 멱등성을 잃는다.
    expect(issueFingerprint(['cus_b', 'cus_a'], 1)).toBe(issueFingerprint(['cus_a', 'cus_b'], 1));
  });

  it('대상이 바뀌면 지문이 바뀐다', () => {
    expect(issueFingerprint(['cus_a'], 1)).not.toBe(issueFingerprint(['cus_a', 'cus_b'], 1));
  });

  it('수량이 바뀌면 지문이 바뀐다', () => {
    expect(issueFingerprint(['cus_a'], 1)).not.toBe(issueFingerprint(['cus_a'], 2));
  });

  it('중복 대상은 한 번만 센다 — 같은 회원을 두 줄로 적어도 같은 제출이다', () => {
    expect(issueFingerprint(['cus_a', 'cus_a'], 1)).toBe(issueFingerprint(['cus_a'], 1));
  });

  it('🔴 구분자가 id 에 섞여도 다른 집합은 다른 지문이다', () => {
    // 순진하게 `ids.join(',') + quantity` 로 쓰면 ["a,b"] 와 ["a","b"] 가 같은 문자열이 되고,
    // 대상이 실제로 바뀌었는데 옛 키를 재사용해 **요청한 장수보다 적게** 발급된다.
    expect(issueFingerprint(['cus_a,cus_b'], 1)).not.toBe(issueFingerprint(['cus_a', 'cus_b'], 1));
  });

  it('빈 대상도 지문을 만든다 — 호출부가 분기 없이 비교할 수 있게', () => {
    expect(issueFingerprint([], 1)).toBe(issueFingerprint([], 1));
    expect(issueFingerprint([], 1)).not.toBe(issueFingerprint(['cus_a'], 1));
  });
});
