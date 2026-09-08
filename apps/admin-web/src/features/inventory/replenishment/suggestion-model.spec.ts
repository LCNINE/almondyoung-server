import type {
  DemandPattern,
  ParameterSource,
  ReplenishmentSuggestionRowDto,
  ResolvedSegmentDto,
} from '@/lib/types/dto/inventory';
import { CustomError } from '@/lib/api/customError';
import {
  FLAG_LABELS,
  PATTERN_LABELS,
  PO_TYPE_LABELS,
  SOURCE_LABELS,
  daysOfCoverLabel,
  formatComputedAt,
  formatOptionalNumber,
  formatSegment,
  formatSourced,
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

  it('숫자 표기 — null 은 대시, 그 외는 지정 자릿수로', () => {
    expect(formatOptionalNumber(null)).toBe('—');
    expect(formatOptionalNumber(1.005)).toBe('1.00');
    expect(formatOptionalNumber(1.2345, 1)).toBe('1.2');
    expect(formatOptionalNumber(0, 1)).toBe('0.0');
  });

  it('리드타임 세그먼트 표기 — 평균 ± 표준편차 (출처), SegmentSource 네 값 전부', () => {
    const seg: ResolvedSegmentDto = {
      meanDays: 12,
      stdDays: 3,
      source: 'observation',
    };
    expect(formatSegment(seg)).toBe('12.0일 ± 3.0 (관측)');
    expect(
      formatSegment({ meanDays: 0, stdDays: 0, source: 'global_default' })
    ).toBe('0.0일 ± 0.0 (전역 기본)');
    expect(
      formatSegment({ meanDays: 5, stdDays: 1, source: 'supplier_rule' })
    ).toBe('5.0일 ± 1.0 (공급사 규칙)');
    expect(
      formatSegment({ meanDays: 8, stdDays: 2, source: 'route_rule' })
    ).toBe('8.0일 ± 2.0 (경로 규칙)');
  });

  it('출처 있는 값 표기 — 값 + 단위? + (출처), 단위 생략 시 빈 문자열', () => {
    expect(formatSourced({ value: 1.5, source: 'grade' })).toBe(
      '1.5 (등급 규칙)'
    );
    expect(formatSourced({ value: 7, source: 'observation' }, '일')).toBe(
      '7일 (관측)'
    );
    expect(formatSourced({ value: 0, source: 'override' }, '일')).toBe(
      '0일 (SKU 예외)'
    );
  });

  // TZ 는 jest 가 UTC 로 고정하지만(scripts/jest/global-setup.js) 로케일 문자열 자체는 Node/ICU
  // 버전이 정한다 — 같은 입력이 `AM 12:00:00` 도 `오전 12:00:00` 도 된다. 전체 문자열을 박으면
  // 런타임 업그레이드가 이 스펙을 깨므로 날짜와 시각 자리수만 본다.
  it('계산 시각 표기 — ISO 문자열을 ko-KR 로케일로', () => {
    const formatted = formatComputedAt('2026-09-01T00:00:00.000Z');
    expect(formatted).toContain('2026. 9. 1.');
    expect(formatted).toMatch(/12:00:00/);
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
