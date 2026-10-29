import type {
  ConsolidationOption,
  ConsolidationProgressSource,
} from '@/lib/types/dto/fulfillment';
import {
  buildConsolidationRequest,
  memoChoices,
  overallProgress,
  sourceProgress,
} from './consolidation-model';

const src = (
  o: Partial<ConsolidationProgressSource>
): ConsolidationProgressSource => ({
  shipmentId: 's1',
  trackingNo: 'T1',
  batchId: null,
  workItemStatus: null,
  waybillId: null,
  waybillStatus: null,
  blockers: [],
  gaveUpAt: null,
  nextCheckAt: null,
  ...o,
});

const opt = (
  shipmentId: string,
  manifestVersion: number,
  reservationVersion: number
): ConsolidationOption => ({
  shipmentId,
  status: 'ready',
  salesOrderNos: [`SO-${shipmentId}`],
  itemSummary: '상품',
  totalQty: 1,
  recipientSnapshot: {},
  batchId: null,
  waybillTrackingNo: null,
  manifestVersion,
  reservationVersion,
  createdAt: '2026-10-29T00:00:00Z',
  reason: 'ok',
  selectable: true,
});

describe('sourceProgress', () => {
  it('작업 항목이 배치에서 진행 중이면 exclude', () =>
    expect(
      sourceProgress(
        src({ blockers: ['ACTIVE_WORK_ITEM'], workItemStatus: 'packing' })
      )
    ).toEqual({ step: 'exclude' }));

  it('빼는 중이면 unpick', () =>
    expect(
      sourceProgress(
        src({ blockers: ['ACTIVE_WORK_ITEM'], workItemStatus: 'withdrawing' })
      )
    ).toEqual({ step: 'unpick' }));

  it('검수 수량만 남으면 unpick', () =>
    expect(
      sourceProgress(src({ blockers: ['CUSTODY_REQUIRES_UNPICK'] }))
    ).toEqual({ step: 'unpick' }));

  it('registered 송장만 남으면 void', () =>
    expect(
      sourceProgress(
        src({ blockers: ['ACTIVE_INVOICE'], waybillStatus: 'registered' })
      )
    ).toEqual({ step: 'void' }));

  it('registered 가 아닌 송장은 stuck', () =>
    expect(
      sourceProgress(
        src({ blockers: ['ACTIVE_INVOICE'], waybillStatus: 'pending' })
      )
    ).toEqual({ step: 'stuck', reason: 'waybill_not_registered' }));

  it('발송 시도가 있으면 stuck', () =>
    expect(
      sourceProgress(src({ blockers: ['DISPATCH_ATTEMPT_EXISTS'] }))
    ).toEqual({ step: 'stuck', reason: 'dispatch_attempt' }));

  it('결품 처리 중이면 stuck', () =>
    expect(
      sourceProgress(
        src({
          blockers: ['ACTIVE_WORK_ITEM'],
          workItemStatus: 'short_pick_recovery',
        })
      )
    ).toEqual({ step: 'stuck', reason: 'short_pick' }));

  it('막힘 없으면 auto', () =>
    expect(sourceProgress(src({}))).toEqual({ step: 'auto' }));
});

describe('overallProgress', () => {
  it('원본 둘이면 뒤처진 쪽과 그 송장번호', () =>
    expect(
      overallProgress([
        src({ shipmentId: 'a', trackingNo: 'TA' }),
        src({
          shipmentId: 'b',
          trackingNo: 'TB',
          blockers: ['ACTIVE_WORK_ITEM'],
          workItemStatus: 'packing',
        }),
      ])
    ).toMatchObject({
      current: { step: 'exclude' },
      shipmentId: 'b',
      trackingNo: 'TB',
    }));

  it('stuck 은 늘 우선', () =>
    expect(
      overallProgress([
        src({ shipmentId: 'a', blockers: ['DISPATCH_ATTEMPT_EXISTS'] }),
        src({
          shipmentId: 'b',
          blockers: ['ACTIVE_WORK_ITEM'],
          workItemStatus: 'packing',
        }),
      ])
    ).toMatchObject({ current: { step: 'stuck' }, shipmentId: 'a' }));

  it('포기한 원본이 있으면 gaveUp', () =>
    expect(
      overallProgress([src({ gaveUpAt: '2026-10-29T00:00:00Z' })]).gaveUp
    ).toBe(true));
});

describe('buildConsolidationRequest', () => {
  it('요청 본문은 늘 recipientSourceShipmentId 만', () => {
    const body = buildConsolidationRequest({
      source: opt('s1', 3, 2),
      picked: [opt('s2', 1, 1)],
      memoFrom: 's2',
      reason: '고객 추가 주문',
    });

    expect(body).toEqual({
      sources: [
        {
          shipmentId: 's1',
          expectedManifestVersion: 3,
          expectedReservationVersion: 2,
        },
        {
          shipmentId: 's2',
          expectedManifestVersion: 1,
          expectedReservationVersion: 1,
        },
      ],
      recipientSourceShipmentId: 's2',
      reason: '고객 추가 주문',
    });
    expect(body).not.toHaveProperty('recipientSnapshot');
  });
});

describe('memoChoices', () => {
  it('메모 선택지는 서버 reason 으로만 정한다(가린 문자열을 비교하지 않는다)', () => {
    const masked: ConsolidationOption = {
      ...opt('s2', 1, 1),
      reason: 'ok',
      recipientSnapshot: { deliveryNote: '***' },
    };

    expect(memoChoices(opt('s1', 3, 2), [masked])).toEqual([]);
  });

  it('memo_differs 가 있으면 메모별로 하나씩', () => {
    const source = {
      ...opt('s1', 1, 1),
      recipientSnapshot: { deliveryNote: '문 앞' },
    };
    const differs: ConsolidationOption = {
      ...opt('s2', 1, 1),
      reason: 'memo_differs',
      recipientSnapshot: { deliveryNote: '' },
    };
    const same: ConsolidationOption = {
      ...opt('s3', 1, 1),
      recipientSnapshot: { deliveryNote: '문 앞' },
    };

    expect(memoChoices(source, [differs, same])).toEqual([
      { shipmentId: 's1', label: '문 앞', orderNo: 'SO-s1' },
      { shipmentId: 's2', label: '메모 없음', orderNo: 'SO-s2' },
    ]);
  });

  it('메모가 literally 메모 없음 이어도 선택지를 잃지 않는다', () => {
    const differs: ConsolidationOption = {
      ...opt('s2', 1, 1),
      reason: 'memo_differs',
      recipientSnapshot: { deliveryNote: '메모 없음' },
    };

    expect(memoChoices(opt('s1', 1, 1), [differs])).toHaveLength(2);
  });

  it('가려진 메모가 같아도 memo_differs 마다 선택지를 둔다', () => {
    const masked = (id: string): ConsolidationOption => ({
      ...opt(id, 1, 1),
      reason: 'memo_differs',
      recipientSnapshot: { deliveryNote: '***' },
    });

    expect(
      memoChoices(opt('s1', 1, 1), [masked('s2'), masked('s3')])
    ).toHaveLength(3);
  });

  it('reason 이 ok 인 상자는 선택지를 더하지 않는다', () => {
    const differs: ConsolidationOption = {
      ...opt('s2', 1, 1),
      reason: 'memo_differs',
    };

    expect(
      memoChoices(opt('s1', 1, 1), [differs, opt('s3', 1, 1)])
    ).toHaveLength(2);
  });
});
