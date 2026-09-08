import type {
  DemandPattern,
  ParameterSource,
  ReplenishmentSuggestionRowDto,
} from '@/lib/types/dto/inventory';
import { CustomError } from '@/lib/api/customError';
import {
  FLAG_LABELS,
  PATTERN_LABELS,
  PO_TYPE_LABELS,
  SOURCE_LABELS,
  daysOfCoverLabel,
  httpStatusOf,
  purchaseAction,
  serverMessageOf,
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
    flags: [],
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
    expect(FLAG_LABELS.default_lead_time).toBe('기본 리드타임');
    expect(FLAG_LABELS.supplier_unknown).toBe('공급사 미정');
    expect(Object.keys(FLAG_LABELS).sort()).toEqual([
      'default_lead_time',
      'low_confidence',
      'supplier_unknown',
    ]);
  });

  it('발주 유형 라벨은 한국어다', () => {
    expect(PO_TYPE_LABELS.foreign).toBe('해외');
    expect(PO_TYPE_LABELS.domestic).toBe('국내');
  });

  it('패턴 라벨은 core 의 DemandPattern 여섯 값을 전부 커버한다', () => {
    const patterns: DemandPattern[] = [
      'smooth',
      'intermittent',
      'erratic',
      'lumpy',
      'insufficient',
      'none',
    ];
    expect(Object.keys(PATTERN_LABELS).sort()).toEqual([...patterns].sort());
    expect(PATTERN_LABELS.smooth).toBe('안정');
  });

  it('출처 라벨은 core 의 ParameterSource 여섯 값을 전부 커버한다', () => {
    const sources: ParameterSource[] = [
      'override',
      'grade',
      'observation',
      'supplier_rule',
      'route_rule',
      'global_default',
    ];
    expect(Object.keys(SOURCE_LABELS).sort()).toEqual([...sources].sort());
    expect(SOURCE_LABELS.global_default).toBe('전역 기본');
  });

  it('커버 일수 표기 — null 은 대시, 0 이하는 소진, 그 외는 「N일」', () => {
    const r = row();
    expect(daysOfCoverLabel(r)).toBe('—'); // 기본 row 는 daysOfCover: null
    expect(
      daysOfCoverLabel(row({ sellable: { ...r.sellable, daysOfCover: 0 } }))
    ).toBe('소진');
    expect(
      daysOfCoverLabel(row({ sellable: { ...r.sellable, daysOfCover: 5 } }))
    ).toBe('5일');
  });
});

describe('httpStatusOf / serverMessageOf — 인터셉터가 던지는 CustomError', () => {
  it('CustomError 의 statusCode · message 를 읽는다', () => {
    const e = new CustomError({
      message: '판매 창고가 정확히 하나가 아닙니다',
      statusCode: 409,
      response: {},
    });
    expect(httpStatusOf(e)).toBe(409);
    expect(serverMessageOf(e)).toBe('판매 창고가 정확히 하나가 아닙니다');
  });

  // lib/api/client.ts 인터셉터가 모든 실패 경로에서 CustomError 를 던지므로 axios 원형
  // (response.status 등)을 볼 일이 없다 — CustomError 가 아닌 입력은 전부 null (#743 B 리뷰 R32-⑤).
  it('CustomError 가 아니면 null', () => {
    expect(httpStatusOf({ response: { status: 403 } })).toBeNull();
    expect(httpStatusOf(new Error('boom'))).toBeNull();
    expect(httpStatusOf(null)).toBeNull();
    expect(
      serverMessageOf({ response: { data: { message: '메시지' } } })
    ).toBeNull();
    expect(serverMessageOf(new Error('boom'))).toBeNull();
    expect(serverMessageOf(null)).toBeNull();
  });
});
