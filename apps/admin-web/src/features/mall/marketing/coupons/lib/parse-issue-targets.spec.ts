import { parseIssueTargets, summarizeIssueResult } from './parse-issue-targets';

describe('parseIssueTargets', () => {
  it('개행과 쉼표로 나눈다', () => {
    expect(parseIssueTargets('alice\nbob, carol')).toEqual(['alice', 'bob', 'carol']);
  });

  it('공백을 다듬고 빈 줄을 버린다', () => {
    expect(parseIssueTargets('  alice  \n\n\n bob \n')).toEqual(['alice', 'bob']);
  });

  it('중복을 제거하되 순서를 지킨다', () => {
    expect(parseIssueTargets('bob\nalice\nbob')).toEqual(['bob', 'alice']);
  });

  it('대소문자가 다른 같은 값은 다른 값으로 둔다 — 로그인아이디는 대소문자를 구분할 수 있다', () => {
    expect(parseIssueTargets('Alice\nalice')).toEqual(['Alice', 'alice']);
  });

  it('빈 입력은 빈 배열이다', () => {
    expect(parseIssueTargets('   \n  ')).toEqual([]);
  });
});

describe('summarizeIssueResult', () => {
  it('발급된 장수를 합산한다', () => {
    const resolved = [
      { input: 'alice', customerId: 'cus_1', label: 'alice@x.com' },
      { input: 'bob', customerId: 'cus_2', label: 'bob@x.com' },
    ];
    const s = summarizeIssueResult(
      { issued: [{ customer_id: 'cus_1', granted: 2 }], skipped: [] },
      resolved,
    );
    expect(s.grantedTotal).toBe(2);
    expect(s.succeeded).toEqual([{ label: 'alice@x.com', granted: 2 }]);
    expect(s.failed).toEqual([{ label: 'bob@x.com', reason: 'unknown' }]);
  });

  it('실패를 사유와 함께 라벨로 되돌린다', () => {
    const resolved = [{ input: 'bob', customerId: 'cus_2', label: 'bob@x.com' }];
    const s = summarizeIssueResult(
      { issued: [], skipped: [{ customer_id: 'cus_2', reason: 'group_mismatch' }] },
      resolved,
    );
    expect(s.succeeded).toEqual([]);
    expect(s.failed).toEqual([{ label: 'bob@x.com', reason: 'group_mismatch' }]);
  });

  it('부분 응답에서 미언급 고객은 unknown 으로 남긴다', () => {
    const resolved = [
      { input: 'alice', customerId: 'cus_1', label: 'alice@x.com' },
      { input: 'bob', customerId: 'cus_2', label: 'bob@x.com' },
      { input: 'carol', customerId: 'cus_3', label: 'carol@x.com' },
    ];
    const s = summarizeIssueResult(
      { issued: [{ customer_id: 'cus_1', granted: 1 }], skipped: [] },
      resolved,
    );
    expect(s.succeeded).toEqual([{ label: 'alice@x.com', granted: 1 }]);
    expect(s.failed).toEqual([
      { label: 'bob@x.com', reason: 'unknown' },
      { label: 'carol@x.com', reason: 'unknown' },
    ]);
  });

  it('응답이 완전히 비어 있으면 모든 고객을 unknown 으로 남긴다', () => {
    const resolved = [
      { input: 'alice', customerId: 'cus_1', label: 'alice@x.com' },
      { input: 'bob', customerId: 'cus_2', label: 'bob@x.com' },
    ];
    const s = summarizeIssueResult({ issued: [], skipped: [] }, resolved);
    expect(s.succeeded).toEqual([]);
    expect(s.failed).toEqual([
      { label: 'alice@x.com', reason: 'unknown' },
      { label: 'bob@x.com', reason: 'unknown' },
    ]);
  });
});
