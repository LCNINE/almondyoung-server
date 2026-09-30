import { isShortPickSettled, shortPickOutcomeMessage } from './short-pick-outcome';

const base = { operationId: 'op', shipmentId: 's', workItemId: 'w', invoiceOperationId: null } as const;

describe('결품 보고 결과 문구', () => {
  it('채움 — 새 로케이션과 재출력 안내', () => {
    expect(
      shortPickOutcomeMessage({
        ...base,
        operationStatus: 'completed',
        outcome: 'refilled',
        refills: [{ shipmentLineId: 'l', skuId: 'k', sourceLocationId: 'x', locationCode: 'B-02-01', qty: 2 }],
        shortages: [],
      }),
    ).toEqual({ tone: 'success', text: '다른 로케이션에서 채웠어요: [B-02-01] 2개. 송장을 다시 출력해야 작업을 이어갈 수 있어요.' });
  });

  it('빼는 중 — 현장에서 집은 상품을 되돌림 바구니로', () => {
    expect(
      shortPickOutcomeMessage({ ...base, operationStatus: 'pending', outcome: 'withdrawing', refills: [], shortages: [] }),
    ).toEqual({
      tone: 'info',
      text: '채울 재고가 없어 박스를 배치에서 빼는 중이에요. 현장에서 송장을 스캔해 집은 상품을 되돌림 바구니로 빼면 박스가 초안으로 돌아가요.',
    });
  });

  it('빠짐 — 초안 복귀', () => {
    expect(
      shortPickOutcomeMessage({ ...base, operationStatus: 'completed', outcome: 'exited', refills: [], shortages: [] }),
    ).toEqual({ tone: 'info', text: '채울 재고가 없어 박스를 배치에서 뺐어요. 박스는 초안으로 돌아갔고 송장은 무효가 됐어요.' });
  });

  it('outcome 이 없으면(옛 서버) null — 옛 처리 그대로, 있으면 보존·재시도 대상이 아니다', () => {
    expect(shortPickOutcomeMessage({ ...base, operationStatus: 'completed' })).toBeNull();
    expect(isShortPickSettled({ ...base, operationStatus: 'completed' })).toBe(false);
    expect(isShortPickSettled({ ...base, operationStatus: 'pending', outcome: 'withdrawing' })).toBe(true);
  });
});
