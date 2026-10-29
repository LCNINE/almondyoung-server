import {
  BOARD_STAGES,
  arrivalLabel,
  canSplitShortage,
  SHORTAGE_WAITING_LABEL,
  shortageActionKind,
  cardAlertText,
  initialBoardStage,
  isSplitQtyAllowed,
  shortageSummary,
  splitUnreservedErrorText,
  SPLIT_QTY_ERROR,
  STALL_BOARD_RESERVE_HREF,
  type ReserveShortageView,
  gaveUpBadge,
  formatDwell,
  cellCount,
  freshness,
  headerStatus,
  stateLabel,
  toProgressPage,
  toProgressSummary,
} from './order-progress.shape';
import { RETURN_STATUS_LABELS } from '@/features/cs/return-exchange/customer-return-labels';

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
      'cancel_request',
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

  it('취소 요청 단계의 세부 상태 이름', () => {
    expect(stateLabel('settle_in_progress')).toBe('환불 처리 중');
    expect(stateLabel('settle_delayed')).toBe('환불 지연');
    expect(stateLabel('settle_refused')).toBe('환불 거절');
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

  it('반품 단계 세부 상태는 반품 예정 기록의 상태 이름이다 (K8 PR 10)', () => {
    for (const status of ['expected', 'arrived', 'inspected', 'held', 'refund_pending'] as const) {
      expect(stateLabel(`return:${status}`)).toBe(`반품 ${RETURN_STATUS_LABELS[status]}`);
    }
    expect(stateLabel('return:zzz')).toBe('반품 zzz');
    // 교환은 PR 11 까지 없다 — 옛 접두어는 모르는 값처럼 그대로 보인다
    expect(stateLabel('exchange:requested')).toBe('exchange:requested');
  });

  it('세부 상태 한국어 이름, 모르는 값은 그대로', () => {
    expect(stateLabel('awaiting_matching')).toBe('매칭 대기');
    expect(stateLabel('return:collection_pending')).toBe('반품 collection_pending');
    expect(stateLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(stateLabel(null)).toBe('');
    expect(stateLabel('DISPATCH_RECALL_PENDING')).toBe('회수 재처리 대기');
    expect(stateLabel('recovery_required')).toBe('복구 필요');
  });
});

describe('자동 멈춤 표시 (#1016 12번)', () => {
  it('카드 경고 문구 — 0 이면 안 보인다', () => {
    expect(cardAlertText(0, 0)).toBe('');
    expect(cardAlertText(3, 0)).toBe('갇힘 3');
    expect(cardAlertText(0, 1)).toBe('자동 멈춤 1');
    expect(cardAlertText(1200, 2)).toBe('갇힘 1,200 · 자동 멈춤 2');
  });

  it('행 배지 — 없으면 null, 여럿이면 행 번호를 잇고 마지막 오류를 title 에', () => {
    expect(gaveUpBadge(undefined)).toBeNull();
    expect(gaveUpBadge([])).toBeNull();
    expect(
      gaveUpBadge([
        {
          rule: 'wake-awaiting-matching',
          row: 12,
          since: '2026-10-08T00:00:00.000Z',
          lastError: 'boom',
        },
        {
          rule: 'x',
          row: 16,
          since: '2026-10-08T00:00:00.000Z',
          lastError: null,
        },
      ])
    ).toEqual({ text: '자동 멈춤 · #12 #16', title: '#12 boom' });
  });

  it('옛 core 응답(gaveUp 없음)도 그대로 받는다', () => {
    const s = toProgressSummary({
      evaluatedAt: null,
      stages: [
        { stage: 'fo', open: 1, stuck: 0, oldestEnteredAt: null, states: [] },
      ],
    });
    expect(s.stages[0].gaveUp ?? 0).toBe(0);
  });

  it('목록 행의 정산 정보 — 있으면 읽고, 옛 core(칸 없음)는 null', () => {
    const page = toProgressPage({
      items: [
        {
          salesOrderId: 'so1', orderNo: 'A', channelOrderId: 'c1', salesChannel: 'medusa', customerName: null, orderedAt: 'x',
          state: 'settle_refused', stageEnteredAt: 'x', stuck: true, walletIntentId: 'int-1',
          settlement: { requestId: 'r1', phase: 'refused', mode: 'auto', confirmedAt: 'a', deadlineAt: 'b', lastFailure: null },
        },
        { salesOrderId: 'so2', orderNo: 'B', channelOrderId: 'c2', salesChannel: 'medusa', customerName: null, orderedAt: 'x', state: 'settle_delayed', stageEnteredAt: 'x', stuck: false },
      ],
      nextCursor: null,
    });
    expect(page.items[0]).toMatchObject({ walletIntentId: 'int-1', settlement: { requestId: 'r1', phase: 'refused' } });
    expect(page.items[1]).toMatchObject({ walletIntentId: null, settlement: null });
  });

  describe('예약 단계 부족 정보(#1016 15번)', () => {
    const shortage = (over: Partial<ReserveShortageView> = {}): ReserveShortageView => ({
      shipmentId: 'sh1',
      manifestVersion: 3,
      consolidated: false,
      splittable: true,
      skuKinds: 10,
      shortSkuKinds: 1,
      items: [{ skuId: 'k1', skuName: '헤어클립 세트', shortQty: 2, expectedArrival: '2026-10-25' }],
      ...over,
    });
    const item = (n: number) => ({ skuId: `k${n}`, skuName: `품목${n}`, shortQty: n, expectedArrival: null });

    it('toProgressPage: shortage 가 있으면 읽고, 없음·형식 틀림은 null', () => {
      const base = { salesOrderId: 'so', orderNo: 'A', channelOrderId: 'c', salesChannel: 'medusa', customerName: null, orderedAt: 'x', state: 'created', stageEnteredAt: 'x', stuck: false };
      const page = toProgressPage({
        items: [
          { ...base, shortage: shortage() },
          { ...base },
          { ...base, shortage: null },
          { ...base, shortage: { shipmentId: 'sh1' } },
          { ...base, shortage: { ...shortage(), items: [{ skuId: 'k', skuName: 'n', shortQty: 'x', expectedArrival: null }] } },
          { ...base, shortage: { ...shortage(), items: [] } },
          { ...base, shortage: 'oops' },
        ],
        nextCursor: null,
      });
      expect(page.items[0].shortage).toEqual(shortage());
      expect(page.items.slice(1).map((i) => i.shortage)).toEqual([null, null, null, null, null, null]);
    });

    it('shortageSummary: «N종 중 M종 · 품목 수량»', () => {
      expect(shortageSummary(shortage())).toBe('10종 중 1종 · 헤어클립 세트 2개');
      expect(shortageSummary(shortage({ shortSkuKinds: 2, items: [item(3), item(1)] }))).toBe('10종 중 2종 · 품목3 3개, 품목1 1개');
      expect(shortageSummary(shortage({ shortSkuKinds: 3, items: [item(3), item(2), item(1)] }))).toBe('10종 중 3종 · 품목3 3개 외 2');
    });

    it('arrivalLabel: YYYY-MM-DD 를 Date 없이 MM-DD 로, 없으면 빈 문자열', () => {
      expect(arrivalLabel('2026-10-25')).toBe('입고 10-25');
      expect(arrivalLabel('2026-01-01')).toBe('입고 01-01');
      expect(arrivalLabel(null)).toBe('');
      expect(arrivalLabel('')).toBe('');
      expect(arrivalLabel('내일')).toBe('');
    });

    it('toProgressPage: splittable 이 없는 옛 core 응답은 false (버튼을 내지 않는다)', () => {
      const base = { salesOrderId: 'so', orderNo: 'A', channelOrderId: 'c', salesChannel: 'medusa', customerName: null, orderedAt: 'x', state: 'created', stageEnteredAt: 'x', stuck: false };
      const { splittable: _omit, ...old } = shortage();
      const page = toProgressPage({ items: [{ ...base, shortage: old }], nextCursor: null });
      expect(page.items[0].shortage).toEqual(shortage({ splittable: false }));
    });

    it('canSplitShortage: 합포장이거나 예약된 몫이 없으면 막는다', () => {
      expect(canSplitShortage(shortage())).toBe(true);
      expect(canSplitShortage(shortage({ consolidated: true }))).toBe(false);
      expect(canSplitShortage(shortage({ splittable: false }))).toBe(false);
    });

    it('shortageActionKind: 합포장 > 나눌 몫 없음(입고 대기) > 나누기', () => {
      expect(shortageActionKind(shortage())).toBe('split');
      expect(shortageActionKind(shortage({ splittable: false }))).toBe('waiting');
      expect(shortageActionKind(shortage({ consolidated: true }))).toBe('consolidated');
      expect(shortageActionKind(shortage({ consolidated: true, splittable: false }))).toBe('consolidated');
      expect(SHORTAGE_WAITING_LABEL).toBe('입고 대기');
    });

    it('initialBoardStage: 보드에 있는 키만, 아니면 fo', () => {
      expect(initialBoardStage('reserve')).toBe('reserve');
      expect(initialBoardStage('collect')).toBe('collect');
      expect(initialBoardStage('nope')).toBe('fo');
      expect(initialBoardStage('')).toBe('fo');
      expect(initialBoardStage(null)).toBe('fo');
    });

    it('isSplitQtyAllowed: 1 이상, 라인 수량 이하, 상자에 수량이 남아야', () => {
      expect(isSplitQtyAllowed(1, 3, 3)).toBe(true);
      expect(isSplitQtyAllowed(2, 3, 5)).toBe(true);
      expect(isSplitQtyAllowed(3, 3, 5)).toBe(true); // 라인 전부여도 상자에 다른 라인이 남으면 된다
      expect(isSplitQtyAllowed(3, 3, 3)).toBe(false); // 상자가 비게 된다
      expect(isSplitQtyAllowed(0, 3, 5)).toBe(false);
      expect(isSplitQtyAllowed(4, 3, 5)).toBe(false);
      expect(isSplitQtyAllowed(1.5, 3, 5)).toBe(false);
      expect(isSplitQtyAllowed(Number.NaN, 3, 5)).toBe(false);
    });

    it('splitUnreservedErrorText: 409 코드별 문구, 모르는 코드는 서버 문구', () => {
      expect(splitUnreservedErrorText('SHIPMENT_FULLY_RESERVED', 'x')).toBe('이미 다 예약됨');
      expect(splitUnreservedErrorText('SHIPMENT_NOTHING_RESERVED', 'x')).toBe('예약된 수량이 없어 나눌 수 없음');
      expect(splitUnreservedErrorText('SHIPMENT_CONSOLIDATED', 'x')).toBe('합포장 상자는 FO 상세에서 나눠야 함');
      expect(splitUnreservedErrorText('SHIPMENT_NOT_DRAFT', 'x')).toBe('이미 계획이 진행된 상자');
      expect(splitUnreservedErrorText(null, '서버 문구')).toBe('서버 문구');
      expect(splitUnreservedErrorText('SOMETHING_ELSE', '서버 문구')).toBe('서버 문구');
    });

    it('상수: 오류 문구와 입구 링크', () => {
      expect(SPLIT_QTY_ERROR).toBe('분할 수량은 1 이상, 라인 수량 이하여야 하고 상자에 수량이 남아야 합니다');
      expect(STALL_BOARD_RESERVE_HREF).toBe('/order/stall-board?stage=reserve');
    });
  });
});
