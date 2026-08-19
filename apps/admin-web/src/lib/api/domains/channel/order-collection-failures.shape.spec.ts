import {
  QUARANTINE_LIST_LIMIT,
  formatQuarantineCount,
  toFailureDetail,
  toFailureListResult,
  toReplayResult,
} from './order-collection-failures.shape';

const ROW = {
  id: 'f-1',
  channel: 'naver',
  externalOrderId: 'ord-1',
  reason: 'channel_product_identification_failed',
  status: 'quarantined',
  affectedLineIds: ['po-1'],
  affectedLines: [{ lineId: 'po-1', cause: 'listing_not_found' as const }],
  rawOrder: {},
  sourceUpdatedAt: '2026-08-19T00:00:00.000Z',
  replayedAt: null,
  replayedWmsOrderId: null,
  errorMessage: null,
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

describe('toFailureListResult', () => {
  /**
   * 공용 인터셉터(`lib/api/client.ts`)가 `{ success, count, data }` 를 이미 벗겨 **배열**을
   * 남긴다. 이것이 실제 런타임 모양이고, 여기서 한 번 더 `.data` 를 읽던 것이 표를 영구히
   * 비게 만든 버그였다.
   */
  it('인터셉터가 벗긴 배열을 받아 count 를 길이에서 되살린다', () => {
    const result = toFailureListResult([ROW, { ...ROW, id: 'f-2' }]);

    expect(result.data).toHaveLength(2);
    expect(result.count).toBe(2);
    expect(result.data[0].id).toBe('f-1');
  });

  it('인터셉터를 통과하지 않은 { count, data } 모양도 받는다', () => {
    const result = toFailureListResult({ success: true, count: 1, data: [ROW] });

    expect(result.count).toBe(1);
    expect(result.data[0].id).toBe('f-1');
  });

  it('모양이 어긋나면 빈 판을 준다 — 화면이 터지는 대신 "없습니다" 를 그린다', () => {
    expect(toFailureListResult(null).count).toBe(0);
    expect(toFailureListResult(undefined).data).toEqual([]);
    expect(toFailureListResult('nope').data).toEqual([]);
    expect(toFailureListResult({ success: true }).data).toEqual([]);
  });

  it('상한에 닿으면 truncated 가 선다 — 잘린 목록을 전부로 보여주지 않기 위함', () => {
    const rows = Array.from({ length: 3 }, (_, i) => ({ ...ROW, id: `f-${i}` }));

    expect(toFailureListResult(rows, 3).truncated).toBe(true);
    expect(toFailureListResult(rows, 4).truncated).toBe(false);
    expect(toFailureListResult(rows, 3).limit).toBe(3);
  });

  it('기본 상한은 서버 기본값 50 보다 크다 — 개통 직후 수백 건이 조용히 잘리던 자리', () => {
    expect(QUARANTINE_LIST_LIMIT).toBeGreaterThan(50);
    expect(toFailureListResult([]).limit).toBe(QUARANTINE_LIST_LIMIT);
  });
});

describe('toFailureDetail', () => {
  it('인터셉터가 벗긴 행을 그대로 받는다', () => {
    expect(toFailureDetail(ROW)?.id).toBe('f-1');
  });

  it('{ data: row } 로 싸여 있으면 벗긴다', () => {
    expect(toFailureDetail({ success: true, data: ROW, replayPath: { fix: 'x', endpoint: null } })?.id).toBe('f-1');
  });

  it('행이 아니면 null 을 준다', () => {
    expect(toFailureDetail(null)).toBeNull();
    expect(toFailureDetail([ROW])).toBeNull();
    expect(toFailureDetail({ success: true })).toBeNull();
  });
});

describe('toReplayResult', () => {
  /**
   * 재처리 응답만 인터셉터를 통과하지 못한다 — 본문에 `data` 키가 없어 envelope 술어
   * (`success === true && 'data' in body`)에 걸리지 않기 때문이다. 그래서 `result` 를 여기서 벗긴다.
   */
  it('{ success, result } 에서 result 를 벗긴다', () => {
    const result = toReplayResult({
      success: true,
      result: { status: 'replayed', failureId: 'f-1', externalOrderId: 'ord-1', emitted: 1, dedupedUnchanged: 0 },
      timestamp: 'x',
    });

    expect(result?.status).toBe('replayed');
    expect(result?.emitted).toBe(1);
  });

  it('이미 벗겨진 결과도 그대로 받는다', () => {
    expect(
      toReplayResult({
        status: 'not_replayable',
        failureId: 'f-1',
        externalOrderId: 'ord-1',
        emitted: 0,
        dedupedUnchanged: 0,
      })?.status
    ).toBe('not_replayable');
  });

  it('모양이 어긋나면 null 을 준다', () => {
    expect(toReplayResult(null)).toBeNull();
    expect(toReplayResult({ success: true })).toBeNull();
  });
});

describe('formatQuarantineCount', () => {
  it('상한에 닿았으면 "더 있다" 를 숫자에 싣는다', () => {
    expect(formatQuarantineCount({ count: 200, truncated: true })).toBe('200+');
  });

  it('상한 미만이면 숫자를 그대로 적는다', () => {
    expect(formatQuarantineCount({ count: 7, truncated: false })).toBe('7');
  });
});
