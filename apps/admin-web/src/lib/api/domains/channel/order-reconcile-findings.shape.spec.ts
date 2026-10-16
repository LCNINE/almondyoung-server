import {
  MISMATCH_LIST_LIMIT,
  type ReconcileFindingDto,
  toClosedFinding,
  toMismatchList,
  toMismatchSummary,
  toRedeliverResult,
} from './order-reconcile-findings.shape';

const finding: ReconcileFindingDto = {
  id: '0192f0c0-0000-7000-8000-000000000001',
  channel: 'medusa',
  externalOrderId: 'order_01',
  displayOrderNo: '1042',
  kind: 'missing_order',
  status: 'open',
  handling: 'human',
  humanReason: 'out_of_window',
  coreStatus: null,
  channelCreatedAt: '2026-10-01T00:00:00.000Z',
  mode: 'observe',
  lastResult: 'skipped',
  attemptCount: 0,
  firstSeenAt: '2026-10-16T09:30:00.000Z',
  lastSeenAt: '2026-10-16T10:00:00.000Z',
  lastAttemptAt: null,
  resolvedAt: null,
  closedAt: null,
  closedBy: null,
  closeMemo: null,
};

describe('toMismatchList', () => {
  it('인터셉터가 벗긴 배열·envelope·data 한 겹을 모두 읽는다', () => {
    const expected = { data: [finding], truncated: false };
    expect(toMismatchList([finding])).toEqual(expected);
    expect(toMismatchList({ success: true, data: [finding] })).toEqual(expected);
    expect(toMismatchList({ data: [finding] })).toEqual(expected);
  });
  it('상한에 닿으면 truncated', () => {
    expect(toMismatchList([finding, finding], 2)?.truncated).toBe(true);
    expect(MISMATCH_LIST_LIMIT).toBe(200);
  });
  it('모양이 다르면 null — 빈 목록으로 그리면 «어긋난 주문 없음»으로 읽힌다', () => {
    expect(toMismatchList('x')).toBeNull();
    expect(toMismatchList({})).toBeNull();
    expect(toMismatchList({ success: true, data: { open: 1 } })).toBeNull();
  });
});

describe('toMismatchSummary', () => {
  const summary = { open: 3, human: 1, gaveUp: 1, oldestFirstSeenAt: '2026-10-16T09:30:00.000Z' };
  it('벗긴 몸통과 envelope 둘 다 읽는다', () => {
    expect(toMismatchSummary(summary)).toEqual(summary);
    expect(toMismatchSummary({ success: true, data: summary, timestamp: 'x' })).toEqual(summary);
  });
  it('oldestFirstSeenAt 이 문자열이 아니면 null 로 둔다', () => {
    expect(toMismatchSummary({ ...summary, oldestFirstSeenAt: null })).toEqual({ ...summary, oldestFirstSeenAt: null });
  });
  it('건수가 숫자가 아니면 null — 0 으로 보면 «정상»으로 읽힌다', () => {
    expect(toMismatchSummary('x')).toBeNull();
    expect(toMismatchSummary({ open: 3 })).toBeNull();
    expect(toMismatchSummary({ quarantined: 3, oldestCreatedAt: null })).toBeNull();
  });
});

describe('toRedeliverResult', () => {
  it('인터셉터를 안 거친 { result } 와 감싼 모양 둘 다', () => {
    expect(toRedeliverResult({ result: 'enqueued' })).toBe('enqueued');
    expect(toRedeliverResult({ success: true, data: { result: 'not_found' } })).toBe('not_found');
  });
  it('모양이 다르면 null', () => {
    expect(toRedeliverResult({})).toBeNull();
    expect(toRedeliverResult({ result: 3 })).toBeNull();
  });
});

describe('toClosedFinding', () => {
  it('{ data: 행 } 과 행 자체 둘 다', () => {
    const closed = { ...finding, status: 'closed' as const, closeMemo: '셀메이트로 나감' };
    expect(toClosedFinding({ data: closed })).toEqual(closed);
    expect(toClosedFinding(closed)).toEqual(closed);
  });
  it('모양이 다르면 null', () => {
    expect(toClosedFinding({ data: null })).toBeNull();
    expect(toClosedFinding('x')).toBeNull();
  });
});
