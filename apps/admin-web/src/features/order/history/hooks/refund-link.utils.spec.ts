import { refundOfTimeline } from './refund-link.utils';

const REL = 'cancellation_linked_wallet_refund';
const link = (id: string, createdAt: string, metadata: Record<string, unknown>) => ({
  id,
  relationName: REL,
  createdAt,
  metadata,
});

describe('refundOfTimeline', () => {
  it('타임라인이 비면 아무것도 없고 결정 대기도 아니다', () => {
    expect(refundOfTimeline([])).toEqual({
      refundStatus: undefined,
      refundLinkId: undefined,
      refundEstimateAmount: undefined,
      manualReason: undefined,
      awaitingDecision: false,
    });
  });

  it('waived 로 닫힌 manual_pending 은 결정 대기가 아니고 최신 링크 상태를 보인다', () => {
    const r = refundOfTimeline([
      link('a', '2026-10-01T00:00:00Z', { refundStatus: 'manual_pending', awaitingDecision: true }),
      link('b', '2026-10-02T00:00:00Z', { refundStatus: 'waived', completedRefundLinkId: 'a' }),
    ]);
    expect(r.refundStatus).toBe('waived');
    expect(r.refundLinkId).toBeUndefined();
    expect(r.awaitingDecision).toBe(false);
  });

  it('succeeded 로 닫힌 manual_pending 도 닫힌다', () => {
    const r = refundOfTimeline([
      link('a', '2026-10-01T00:00:00Z', { refundStatus: 'manual_pending' }),
      link('b', '2026-10-02T00:00:00Z', { refundStatus: 'succeeded', completedRefundLinkId: 'a' }),
    ]);
    expect(r.refundStatus).toBe('succeeded');
    expect(r.refundLinkId).toBeUndefined();
  });

  it('awaitingDecision manual_pending 은 awaitingDecision: true 와 그 링크 id', () => {
    const r = refundOfTimeline([
      link('a', '2026-10-01T00:00:00Z', {
        refundStatus: 'manual_pending',
        awaitingDecision: true,
        refundEstimateAmount: 5000,
        manualReason: 'x',
      }),
    ]);
    expect(r).toEqual({
      refundStatus: 'manual_pending',
      refundLinkId: 'a',
      refundEstimateAmount: 5000,
      manualReason: 'x',
      awaitingDecision: true,
    });
  });

  it('옛 manual_pending(플래그 없음)은 awaitingDecision: false', () => {
    const r = refundOfTimeline([
      link('a', '2026-10-01T00:00:00Z', { refundStatus: 'manual_pending' }),
    ]);
    expect(r.refundStatus).toBe('manual_pending');
    expect(r.refundLinkId).toBe('a');
    expect(r.awaitingDecision).toBe(false);
  });

  it('최신 requested 는 awaitingDecision: true', () => {
    const r = refundOfTimeline([
      link('a', '2026-10-01T00:00:00Z', { refundStatus: 'requested' }),
    ]);
    expect(r.refundStatus).toBe('requested');
    expect(r.awaitingDecision).toBe(true);
  });

  it('다른 관계 이름의 링크는 무시한다', () => {
    const r = refundOfTimeline([
      { id: 'z', relationName: 'other', createdAt: '2026-10-01T00:00:00Z', metadata: { refundStatus: 'failed' } },
    ]);
    expect(r.refundStatus).toBeUndefined();
  });
});
