import type { ReplenishmentSuggestionRowDto } from '@/lib/types/dto/inventory';
import {
  FLAG_LABELS,
  purchaseAction,
  summarizeActions,
  toCartPayload,
  toTransferPayload,
  transferAction,
  urgencyLabel,
} from './suggestion-model';

function row(
  overrides: Partial<ReplenishmentSuggestionRowDto> = {}
): ReplenishmentSuggestionRowDto {
  return {
    skuId: 'sku-1',
    skuCode: 'S1',
    skuName: 'sku one',
    supplier: { id: 'sup-1', name: 'A' },
    pattern: 'insufficient',
    grade: 'C',
    confidence: 'low',
    demand: { dailyMean: 0, dailyStd: 0 },
    company: {
      onHand: 0,
      inTransfer: 0,
      onOrder: 0,
      reserved: 0,
      position: 0,
      safetyStock: 100,
      reorderPoint: 100,
      targetLevel: 100,
      leadTimeDays: 0,
    },
    sellable: {
      warehouseId: 'wh-sell',
      onHand: 60,
      reserved: 0,
      inTransit: 0,
      onOrderDirect: 0,
      position: 60,
      safetyStock: 100,
      reorderPoint: 100,
      targetLevel: 100,
      leadTimeDays: 0,
      daysOfCover: null,
    },
    actions: [
      {
        type: 'purchase',
        qty: 60,
        supplierId: 'sup-1',
        sourceWarehouseId: null,
      },
      {
        type: 'transfer',
        qty: 30,
        fromWarehouseId: 'wh-china',
        toWarehouseId: 'wh-sell',
        lines: [{ fromLocationId: 'loc-a', quantity: 30 }],
      },
    ],
    flags: ['legacy_only'],
    legacyReorderPoint: 100,
    ...overrides,
  };
}

describe('suggestion-model', () => {
  it('액션을 종류별로 꺼낸다', () => {
    expect(purchaseAction(row())?.qty).toBe(60);
    expect(transferAction(row())?.qty).toBe(30);
    expect(purchaseAction(row({ actions: [] }))).toBeNull();
  });

  it('요약 문구', () => {
    expect(summarizeActions(row())).toBe('발주 60 · 이동 30');
    expect(
      summarizeActions(
        row({
          actions: [
            {
              type: 'purchase',
              qty: 60,
              supplierId: null,
              sourceWarehouseId: null,
            },
          ],
        })
      )
    ).toBe('발주 60');
    expect(summarizeActions(row({ actions: [] }))).toBe('—');
  });

  it('카트 페이로드는 공급사를 싣고, 없으면 생략한다', () => {
    const r = row();
    expect(toCartPayload(r, purchaseAction(r)!, 'foreign')).toEqual({
      skuId: 'sku-1',
      quantity: 60,
      type: 'foreign',
      supplierId: 'sup-1',
    });
    const noSup = row({
      supplier: null,
      actions: [
        { type: 'purchase', qty: 5, supplierId: null, sourceWarehouseId: null },
      ],
    });
    expect(toCartPayload(noSup, purchaseAction(noSup)!, 'domestic')).toEqual({
      skuId: 'sku-1',
      quantity: 5,
      type: 'domestic',
    });
  });

  it('이동 지시서 페이로드는 제안 라인을 그대로 싣는다', () => {
    const r = row();
    expect(toTransferPayload(r, transferAction(r)!, '보충 제안')).toEqual({
      fromWarehouseId: 'wh-china',
      toWarehouseId: 'wh-sell',
      memo: '보충 제안',
      lines: [{ skuId: 'sku-1', fromLocationId: 'loc-a', quantity: 30 }],
    });
  });

  it('긴급도 문구는 판매창고 위치 − 재주문점', () => {
    expect(urgencyLabel(row())).toBe('부족 40');
    expect(
      urgencyLabel(row({ sellable: { ...row().sellable, position: 112 } }))
    ).toBe('여유 12');
  });

  it('플래그 라벨은 전부 한국어', () => {
    expect(FLAG_LABELS.legacy_only).toBe('정적 안전재고');
    expect(FLAG_LABELS.supplier_unknown).toBe('공급사 미정');
    expect(Object.keys(FLAG_LABELS).sort()).toEqual([
      'default_lead_time',
      'legacy_only',
      'low_confidence',
      'supplier_unknown',
    ]);
  });
});
