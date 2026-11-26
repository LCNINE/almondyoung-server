import { recallNoticeOf } from './recall-notice';

const recalled = {
  attemptNo: 1,
  status: 'recalled',
  recalledAt: '2026-01-02T01:05:00Z',
};
const recallOperation = (reasonCode: string, completedAt: string) => ({
  type: 'recall',
  status: 'completed' as const,
  reason: reasonCode,
  reasonCode,
  completedAt,
});

describe('recallNoticeOf', () => {
  it('마지막 출고를 되돌린 창고 상자에 사유와 다음 할 일을 준다', () => {
    const notice = recallNoticeOf({
      status: 'draft',
      supplierId: null,
      dispatchAttempts: [recalled],
      operations: [
        recallOperation('package_recovered', '2026-01-02T00:00:00Z'),
        recallOperation('carrier_handoff_failed', '2026-01-02T01:05:00Z'),
      ],
    });

    expect(notice?.title).toContain('출고를 되돌렸어요 · 택배사 인계 실패');
    expect(notice?.lines).toEqual([
      '돌려받은 상품은 «출고 재작업존» 재고로 잡혀 있어요.',
      '출고 준비에서 다시 준비하면 새 송장을 받아 다시 배치에 담아요.',
    ]);
  });

  it('주소 수정으로 되돌렸으면 받는 분 확인을 먼저 적는다', () => {
    expect(
      recallNoticeOf({
        status: 'draft',
        dispatchAttempts: [recalled],
        operations: [
          recallOperation('address_correction', '2026-01-02T01:05:00Z'),
        ],
      })?.lines[1]
    ).toBe('주소 수정으로 되돌렸어요 — 받는 분 주소를 고쳤는지 확인해 주세요.');
  });

  it('다시 출고했거나 입점사 상자거나 출고한 상자면 보이지 않는다', () => {
    const base = {
      status: 'draft',
      operations: [
        recallOperation('carrier_handoff_failed', '2026-01-02T01:05:00Z'),
      ],
    };

    expect(
      recallNoticeOf({
        ...base,
        dispatchAttempts: [
          recalled,
          { attemptNo: 2, status: 'dispatched', recalledAt: null },
        ],
      })
    ).toBeNull();
    expect(
      recallNoticeOf({
        ...base,
        supplierId: 'supplier-1',
        dispatchAttempts: [recalled],
      })
    ).toBeNull();
    expect(
      recallNoticeOf({
        ...base,
        status: 'shipped',
        dispatchAttempts: [recalled],
      })
    ).toBeNull();
    expect(recallNoticeOf({ ...base, dispatchAttempts: [] })).toBeNull();
  });
});
