import {
  BOARD_STAGES,
  formatDwell,
  cellCount,
  freshness,
  headerStatus,
  stateLabel,
  toProgressPage,
  toProgressSummary,
} from './order-progress.shape';

describe('order-progress shape', () => {
  it('보드 단계 순서: 0 수집부터 8 추적, 그다음 취소·반품·교환·분류 안 됨', () => {
    expect(BOARD_STAGES.map((s) => s.key)).toEqual([
      'collect',
      'accept',
      'fo',
      'reserve',
      'plan',
      'waybill',
      'pick',
      'dispatch',
      'track',
      'cancel',
      'return_exchange',
      'unclassified',
    ]);
    expect(BOARD_STAGES.slice(0, 9).map((s) => s.no)).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
  });

  it('요약은 envelope 여부와 무관하게 읽고, 깨진 몸통은 빈 요약', () => {
    const body = {
      evaluatedAt: '2026-10-06T00:00:00.000Z',
      stages: [
        { stage: 'fo', open: 2, stuck: 1, oldestEnteredAt: null, states: [] },
      ],
    };
    expect(toProgressSummary(body).stages[0].open).toBe(2);
    expect(
      toProgressSummary({ success: true, data: body }).stages[0].open
    ).toBe(2);
    expect(toProgressSummary(null)).toEqual({ evaluatedAt: null, stages: [] });
  });

  it('목록 쪽은 items·nextCursor 를 읽는다', () => {
    expect(toProgressPage({ items: [], nextCursor: 'x' })).toEqual({
      items: [],
      nextCursor: 'x',
    });
    expect(toProgressPage(undefined)).toEqual({ items: [], nextCursor: null });
  });

  it('체류 표기', () => {
    expect(formatDwell(4 * 60_000)).toBe('4분');
    expect(formatDwell(3 * 3_600_000 + 12 * 60_000)).toBe('3시간 12분');
    expect(formatDwell(6 * 3_600_000)).toBe('6시간');
    expect(formatDwell(82 * 86_400_000 + 5 * 3_600_000)).toBe('82일');
    expect(formatDwell(0)).toBe('0분');
  });

  // Review Focus 5
  it('판정 전(null)이거나 5분 넘게 멈췄으면 stale', () => {
    const now = new Date('2026-10-06T00:10:00.000Z');
    expect(freshness(null, now)).toBe('stale');
    expect(freshness('2026-10-06T00:05:00.000Z', now)).toBe('fresh');
    expect(freshness('2026-10-06T00:04:59.000Z', now)).toBe('stale');
    expect(freshness('not-a-date', now)).toBe('stale');
  });

  it('머리말: 조회 실패는 이전 data 가 있어도 빨강, 데이터 없으면 빈 문구', () => {
    const now = new Date('2026-10-06T00:10:00.000Z');
    const ok = '2026-10-06T00:08:00.000Z';
    expect(headerStatus({ isError: true, hasData: false }, null, now)).toEqual({
      text: '판정 조회 실패',
      tone: 'stale',
    });
    expect(headerStatus({ isError: true, hasData: true }, ok, now)).toEqual({
      text: '판정 조회 실패 · 마지막 2분 전 판정',
      tone: 'stale',
    });
    expect(headerStatus({ isError: false, hasData: false }, null, now)).toEqual(
      { text: '', tone: 'normal' }
    );
    expect(headerStatus({ isError: false, hasData: true }, null, now)).toEqual({
      text: '판정 전',
      tone: 'stale',
    });
    expect(headerStatus({ isError: false, hasData: true }, ok, now)).toEqual({
      text: '2분 전 판정',
      tone: 'normal',
    });
    expect(
      headerStatus(
        { isError: false, hasData: true },
        '2026-10-06T00:00:00.000Z',
        now
      ).tone
    ).toBe('stale');
  });

  it('칸 건수: 못 얻었으면 0 이 아니라 null', () => {
    expect(cellCount(0, true)).toBe(0);
    expect(cellCount(5, true)).toBe(5);
    expect(cellCount(5, false)).toBeNull();
    expect(cellCount(undefined, true)).toBeNull();
  });

  it('세부 상태 한국어 이름, 모르는 값은 그대로', () => {
    expect(stateLabel('awaiting_matching')).toBe('매칭 대기');
    expect(stateLabel('return:collection_pending')).toBe('반품 회수 대기');
    expect(stateLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(stateLabel(null)).toBe('');
    expect(stateLabel('DISPATCH_RECALL_PENDING')).toBe('회수 재처리 대기');
    expect(stateLabel('recovery_required')).toBe('복구 필요');
  });
});
