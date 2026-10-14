import { readFileSync } from 'fs';
import { join } from 'path';
import type { OrderLineDto } from '@/lib/types/dto/matching';
import {
  COMPOSITION_ERROR_MESSAGES,
  applyResultText,
  compositionItemText,
  compositionErrorView,
  existingLinesStep,
  canEditLineComposition,
  foItemStatusLabel,
  matchingRowTarget,
  sourceBadge,
} from './line-composition-view';

// axios client 인터셉터가 던지는 모양: CustomError({ statusCode, response: <응답 본문> })
function serverError(status: number, body: Record<string, unknown>) {
  return { message: String(body.message ?? ''), statusCode: status, response: body };
}

const box = (over: Record<string, unknown> = {}) => ({
  shipmentId: 's-1',
  status: 'planned',
  batchId: null,
  hasActiveWaybill: false,
  ...over,
});

describe('sourceBadge', () => {
  it('shows only the operator source — matching is the normal state', () => {
    expect(sourceBadge('operator')).toBe('개별 지정');
    expect(sourceBadge('matching')).toBeNull();
    expect(sourceBadge(null)).toBeNull();
    expect(sourceBadge(undefined)).toBeNull();
  });
});

describe('compositionItemText', () => {
  const item = { skuId: 's', skuCode: 'C', skuName: '리본' };
  it('1개당 1 이면 이름만', () => {
    expect(compositionItemText({ ...item, qtyPerUnit: 1 })).toBe('리본');
  });
  it('1개당 2 이상이면 이름 ×N', () => {
    expect(compositionItemText({ ...item, qtyPerUnit: 3 })).toBe('리본 ×3');
  });
});

describe('foItemStatusLabel', () => {
  it('qty 0 = 구성 변경으로 빠진 SKU → «대체됨»', () => {
    expect(foItemStatusLabel({ qty: 0, status: 'pending' })).toBe('대체됨');
  });
  it('옛 부분취소는 qty 0 + canceled 로 쓴다 → 상태 그대로', () => {
    expect(foItemStatusLabel({ qty: 0, status: 'canceled' })).toBe('canceled');
  });
  it('고객 취소·부분 감소는 상태 그대로', () => {
    expect(foItemStatusLabel({ qty: 2, status: 'partial' })).toBe('partial');
    expect(foItemStatusLabel({ qty: 1, status: 'pending' })).toBe('pending');
    // 고객 취소는 qty 가 그대로(canceledQty 가 들고 있음)라 «대체됨» 이 아니다
    const canceled = { qty: 2, canceledQty: 2, status: 'canceled' };
    expect(foItemStatusLabel(canceled)).toBe('canceled');
  });
});

describe('canEditLineComposition', () => {
  it('직배 출고는 서버가 개별 지정을 거절하므로 숨긴다', () => {
    expect(canEditLineComposition({ canEdit: true, fulfillmentMode: 'drop_ship' })).toBe(false);
  });
  it('직배가 아니면 권한을 따른다', () => {
    expect(canEditLineComposition({ canEdit: true, fulfillmentMode: 'in_house' })).toBe(true);
    expect(canEditLineComposition({ canEdit: true, fulfillmentMode: null })).toBe(true);
    expect(canEditLineComposition({ canEdit: false, fulfillmentMode: 'in_house' })).toBe(false);
  });
});

describe('matchingRowTarget', () => {
  const base: OrderLineDto = {
    id: 'line-1',
    variantId: 'v-1',
    productName: '상품',
    quantity: 2,
    salesOrderId: 'so-1',
    channelOrderId: 'c-1',
    salesChannel: 'medusa',
    orderDate: '2026-10-14T00:00:00.000Z',
    matchedSkus: [{ skuId: 'm', skuName: '매칭 SKU', skuCode: 'M', quantity: 3 }],
  };

  it('굳힌 라인은 라인 구성으로 채운다(상품매칭이 바뀌었어도 박스에 든 것)', () => {
    const target = matchingRowTarget({
      ...base,
      compositionSource: 'matching',
      composition: [{ skuId: 'f', skuCode: 'F', skuName: '굳힌 SKU', qtyPerUnit: 1 }],
    });
    expect(target).toEqual({
      salesOrderId: 'so-1',
      salesOrderLineId: 'line-1',
      productName: '상품',
      quantity: 2,
      composition: [{ skuId: 'f', skuCode: 'F', skuName: '굳힌 SKU', qtyPerUnit: 1 }],
    });
  });

  it('굳히지 않은 라인은 현재 상품매칭으로 채운다', () => {
    expect(matchingRowTarget(base).composition).toEqual([
      { skuId: 'm', skuCode: 'M', skuName: '매칭 SKU', qtyPerUnit: 3 },
    ]);
  });

  it('옛 core(composition 칸 없음)는 상품매칭으로 물러선다', () => {
    expect(matchingRowTarget({ ...base, compositionSource: 'operator' }).composition).toHaveLength(1);
  });
});

describe('existingLinesStep', () => {
  const impact = {
    variantId: 'v',
    applicable: true,
    newComposition: [{ skuId: 's', qtyPerUnit: 1 }],
    changeable: 3,
    skippedOperator: 1,
    skippedInProgress: 0,
    alreadySame: 2,
  };

  it('바꿀 것이 있을 때만 단계가 뜨고, 0 인 칸은 숨긴다', () => {
    expect(existingLinesStep(impact)).toEqual({
      changeable: 3,
      counts: [
        { label: '바꿀 수 있음', count: 3 },
        { label: '개별 지정', count: 1 },
        { label: '이미 같음', count: 2 },
      ],
    });
  });

  it.each([
    ['건너뜀만 있음', { ...impact, changeable: 0, skippedInProgress: 4 }],
    ['적용 불가(void·링크 0)', { ...impact, applicable: false }],
  ])('%s → 단계 없음', (_name, value) => {
    expect(existingLinesStep(value)).toBeNull();
  });

  it('미리보기가 없으면 단계 없음', () => {
    expect(existingLinesStep(null)).toBeNull();
    expect(existingLinesStep(undefined)).toBeNull();
  });
});

describe('applyResultText', () => {
  it('건너뜀이 없으면 바뀐 수만', () => {
    expect(applyResultText({ changed: 3, skipped: [] })).toBe('바뀜 3');
  });
  it('건너뜀은 합계와 사유별', () => {
    expect(
      applyResultText({
        changed: 1,
        skipped: [
          { reason: 'operator', count: 2 },
          { reason: 'in_progress', count: 1 },
          { reason: 'units_ambiguous', count: 1 },
        ],
      }),
    ).toBe('바뀜 1 · 건너뜀 4(개별 지정 2 · 작업 중 1 · 수량 계산 불가 1)');
  });
});

describe('compositionErrorView', () => {
  it('배치에 든 박스 → 배치 링크(드로어가 열린다)', () => {
    const view = compositionErrorView(
      serverError(409, {
        code: 'LINE_BOX_NOT_DRAFT',
        message: 'blocked',
        details: { fulfillmentOrderId: 'fo-1', boxes: [box({ batchId: 'b-1', status: 'draft' })] },
      }),
    );
    expect(view.message).toBe('배치에 들어간 박스가 있습니다. 배치에서 뺀 뒤 다시 하세요.');
    expect(view.links).toEqual([{ label: '배치 열기', href: '/order/outbound-batches?batchId=b-1' }]);
    expect(view.retry).toBe(false);
  });

  it('배치 없는 박스 → 출고 주문 링크, 같은 배치·FO 는 한 번만', () => {
    const view = compositionErrorView(
      serverError(409, {
        code: 'LINE_BOX_NOT_DRAFT',
        details: {
          fulfillmentOrderId: 'fo-1',
          boxes: [box({ hasActiveWaybill: true }), box({ shipmentId: 's-2' }), box({ shipmentId: 's-3', batchId: 'b-1' }), box({ shipmentId: 's-4', batchId: 'b-1' })],
        },
      }),
    );
    expect(view.links).toEqual([
      { label: '출고 주문 열기', href: '/order/fulfillments/fo-1' },
      { label: '배치 열기', href: '/order/outbound-batches?batchId=b-1' },
    ]);
  });

  it('송장이 있는 박스는 송장 사유를 먼저 말한다(배치 없음)', () => {
    const view = compositionErrorView(
      serverError(409, { code: 'LINE_BOX_NOT_DRAFT', details: { fulfillmentOrderId: 'fo-1', boxes: [box({ status: 'draft', hasActiveWaybill: true })] } }),
    );
    expect(view.message).toBe('송장이 발행된 박스가 있습니다. 송장을 취소한 뒤 다시 하세요.');
  });

  it('보고 있는 출고 주문으로 가는 링크는 내지 않는다', () => {
    const view = compositionErrorView(
      serverError(409, { code: 'LINE_BOX_NOT_DRAFT', details: { fulfillmentOrderId: 'fo-1', boxes: [box()] } }),
      { currentFulfillmentOrderId: 'fo-1' },
    );
    expect(view.message).toBe('확정된 박스가 있습니다. 작성 중 박스만 바꿀 수 있습니다.');
    expect(view.links).toEqual([]);
  });

  it.each([
    ['details 없음(옛 core)', { code: 'LINE_BOX_NOT_DRAFT', message: 'blocked' }],
    ['박스 항목이 깨짐', { code: 'LINE_BOX_NOT_DRAFT', details: { fulfillmentOrderId: 'fo-1', boxes: [{ shipmentId: 1 }] } }],
  ])('%s → 사유 문구는 보이고 링크만 없다', (_name, body) => {
    const view = compositionErrorView(serverError(409, body));
    expect(view.message).toBe('작성 중이 아닌 박스에 담겨 있어 바꿀 수 없습니다.');
    expect(view.links).toEqual([]);
  });

  it('경합 재시도 코드는 retry', () => {
    expect(compositionErrorView(serverError(409, { code: 'SHIPMENT_COMPONENT_CHANGED_RETRY' })).retry).toBe(true);
    expect(compositionErrorView(serverError(409, { code: 'FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY' })).retry).toBe(true);
  });

  it('모르는 코드·코드 없는 404·검증 400 은 서버 메시지 그대로', () => {
    expect(compositionErrorView(serverError(409, { code: 'NEW_CODE', message: '새 사유' })).message).toBe('새 사유');
    expect(compositionErrorView(serverError(404, { message: 'Line x is not in sales order y' })).message).toBe(
      'Line x is not in sales order y',
    );
    expect(compositionErrorView(serverError(400, { message: ['items must contain at least 1 elements'] })).message).toBe(
      'items must contain at least 1 elements',
    );
  });

  it('core 수정 경로가 던지는 코드는 전부 문구가 있다', () => {
    // 코드 목록은 core 소스가 정본이다 — 새 코드가 생기면 이 스펙이 빨개진다
    const root = join(__dirname, '../../../../../../apps/core/src/modules/fulfillment');
    const sources = [
      'line-composition-edit/line-composition-edit.manager.ts',
      'draft-box/draft-box-amender.ts',
      'draft-box/box-target.ts',
    ].map((file) => readFileSync(join(root, file), 'utf8'));
    const thrown = new Set<string>();
    for (const source of sources) {
      for (const match of source.matchAll(/(?:conflict|badRequest)\(\s*'([A-Z0-9_]+)'|code:\s*'([A-Z0-9_]+)'/g)) {
        thrown.add(match[1] ?? match[2]);
      }
    }
    // amend 가드(shipment-aggregate)와 불변식 재시도는 다른 파일이 던지지만 이 경로에서 나온다(스펙 §7.4)
    for (const code of [
      'SHIPMENT_ACTIVE_WORK_ITEM',
      'SHIPMENT_CUSTODY_EXISTS',
      'SHIPMENT_ACTIVE_INVOICE',
      'FULFILLMENT_INVARIANT_COMPONENT_CHANGED_RETRY',
    ]) {
      thrown.add(code);
    }
    // 숫자가 든 코드를 놓치던 옛 정규식의 카나리
    expect(thrown.has('SKU_HOLDER_MISMATCH_FOR_3PL')).toBe(true);
    expect(thrown.size).toBeGreaterThan(10);
    expect([...thrown].filter((code) => !(code in COMPOSITION_ERROR_MESSAGES))).toEqual([]);
  });
});
