import type {
  ConsolidationOption,
  ConsolidationOptionReason,
  ConsolidationOptionShipment,
} from '@/lib/types/dto/fulfillment';
import { buildConsolidationRequest } from './consolidation-model';
import {
  freshCommand,
  isStaleVersionConflict,
  keptAfterFailure,
  needsReopenPermission,
  needsUnwindSteps,
  optionCard,
  showsConsolidationButton,
  step2Blocker,
  togglePick,
  type SheetPermissions,
} from './consolidation-sheet-model';

const shipment = (
  shipmentId: string,
  overrides: Partial<ConsolidationOptionShipment> = {}
): ConsolidationOptionShipment => ({
  shipmentId,
  status: 'draft',
  salesOrderNos: [`SO-${shipmentId}`],
  itemSummary: '상품',
  totalQty: 1,
  recipientSnapshot: {},
  batchId: null,
  waybillTrackingNo: null,
  manifestVersion: 1,
  reservationVersion: 1,
  createdAt: '2026-10-29T00:00:00Z',
  ...overrides,
});

const option = (
  shipmentId: string,
  reason: ConsolidationOptionReason,
  overrides: Partial<ConsolidationOptionShipment> = {}
): ConsolidationOption => ({
  ...shipment(shipmentId, overrides),
  reason,
  selectable: reason === 'ok' || reason === 'memo_differs',
});

const all: SheetPermissions = { canOverrideRecipient: true, canReopen: true };
const noOverride: SheetPermissions = {
  canOverrideRecipient: false,
  canReopen: true,
};
const noReopen: SheetPermissions = {
  canOverrideRecipient: true,
  canReopen: false,
};

describe('합포장 버튼', () => {
  const both = { canConsolidate: true, canReopen: true };

  it('draft 상자는 합포장 권한만 있으면 보인다', () => {
    expect(
      showsConsolidationButton(
        { status: 'draft', supplierId: null },
        { canConsolidate: true, canReopen: false }
      )
    ).toBe(true);
  });

  it('draft 가 아니면 재개방 권한도 있어야 보인다', () => {
    const planned = { status: 'planned', supplierId: null };

    expect(
      showsConsolidationButton(planned, {
        canConsolidate: true,
        canReopen: false,
      })
    ).toBe(false);
    expect(showsConsolidationButton(planned, both)).toBe(true);
  });

  it('합포장 권한이 없으면 숨긴다', () => {
    expect(
      showsConsolidationButton(
        { status: 'draft', supplierId: null },
        { canConsolidate: false, canReopen: true }
      )
    ).toBe(false);
  });

  it('직배 상자는 숨긴다', () => {
    expect(
      showsConsolidationButton({ status: 'draft', supplierId: 'sup-1' }, both)
    ).toBe(false);
  });

  it.each([
    'open',
    'shipped',
    'in_transit',
    'delivered',
    'failed',
    'canceled',
    'superseded',
    'recovery_required',
  ])('%s 상자는 숨긴다', (status) => {
    expect(showsConsolidationButton({ status, supplierId: null }, both)).toBe(
      false
    );
  });
});

describe('1단계 주문 카드', () => {
  it('배송지가 다른 주문은 고를 수 없다', () => {
    const card = optionCard(option('b', 'address_differs'), all);

    expect(card.pickable).toBe(false);
    expect(card.note).toBe('배송지가 달라서 같이 보낼 수 없어요.');
    expect(card.addressMark).toBe('(다름)');
    expect(togglePick([], option('b', 'address_differs'), all)).toEqual([]);
  });

  const lacking: ConsolidationOptionReason[] = [
    'incomplete_recipient',
    'unknown_customer',
  ];

  it.each(lacking)('%s 는 정보가 부족하다고 쓰고 고를 수 없다', (reason) => {
    const card = optionCard(option('b', reason), all);

    expect(card.pickable).toBe(false);
    expect(card.note).toBe('정보가 부족해 합칠 수 없어요.');
  });

  it('카드 어디를 눌러도 체크된다', () => {
    const ok = option('b', 'ok');
    const picked = togglePick([], ok, noOverride);

    expect(picked).toEqual(['b']);
    expect(togglePick(picked, ok, noOverride)).toEqual([]);
  });

  it('(같음)/(다름)은 서버 reason 으로만 붙인다', () => {
    const same = optionCard(option('b', 'ok'), noOverride);
    const memo = optionCard(option('c', 'memo_differs'), all);

    expect([same.addressMark, same.memoMark]).toEqual(['(같음)', '(같음)']);
    expect([memo.addressMark, memo.memoMark]).toEqual(['(같음)', '(다름)']);
  });

  it('override_recipient 가 없으면 memo_differs 카드도 비활성이고 이유를 쓴다', () => {
    const memo = option('c', 'memo_differs');
    const card = optionCard(memo, noOverride);

    expect(card.pickable).toBe(false);
    expect(card.note).toBe(
      '배송 메모가 달라 합치려면 수령인 변경 권한이 필요해요'
    );
    expect(togglePick([], memo, noOverride)).toEqual([]);
  });

  it('override_recipient 가 있으면 memo_differs 카드를 고를 수 있다', () => {
    const memo = option('c', 'memo_differs');

    expect(optionCard(memo, all).pickable).toBe(true);
    expect(togglePick([], memo, all)).toEqual(['c']);
  });

  it('재개방 권한이 없으면 계획이 확정된 주문은 고를 수 없고 이유를 쓴다', () => {
    const planned = option('p', 'ok', { status: 'planned' });
    const card = optionCard(planned, noReopen);

    expect(card.pickable).toBe(false);
    expect(card.tone).toBe('blocked');
    expect(card.note).toBe(
      '출고 준비가 시작된 주문이라 합치려면 출고 재개방 권한이 필요해요'
    );
    expect(togglePick([], planned, noReopen)).toEqual([]);
  });

  it('재개방 권한이 없으면 배치나 송장이 걸린 draft 주문도 고를 수 없다', () => {
    expect(
      optionCard(option('b', 'ok', { batchId: 'batch-1' }), noReopen).pickable
    ).toBe(false);
    expect(
      optionCard(option('w', 'ok', { waybillTrackingNo: 'T1' }), noReopen)
        .pickable
    ).toBe(false);
  });

  it('재개방 권한이 없어도 draft 끼리는 합칠 수 있다', () => {
    const draft = option('d', 'ok');

    expect(optionCard(draft, noReopen).pickable).toBe(true);
    expect(togglePick([], draft, noReopen)).toEqual(['d']);
  });

  it('재개방 권한이 있으면 계획이 확정된 주문도 고를 수 있다', () => {
    expect(
      optionCard(option('p', 'ok', { status: 'planned' }), all).pickable
    ).toBe(true);
  });
});

describe('2단계 요청 버튼', () => {
  const ready = {
    hasLostCommand: false,
    pickedCount: 1,
    needsReopen: false,
    hasMemoChoices: false,
    memoFrom: 'a',
    reason: '고객 요청',
  };

  it('메모가 다른 주문을 고르면 메모를 골라야 요청이 켜진다', () => {
    expect(step2Blocker({ ...ready, hasMemoChoices: true, memoFrom: '' })).toBe(
      '합친 상자의 배송 메모를 골라 주세요'
    );
    expect(
      step2Blocker({ ...ready, hasMemoChoices: true, memoFrom: 'c' })
    ).toBeNull();
  });

  it('작업 사유가 비면 요청이 꺼진다', () => {
    expect(step2Blocker({ ...ready, reason: '  ' })).toBe(
      '작업 사유를 적어 주세요'
    );
  });

  it('다시 읽은 뒤 고른 주문이 모두 빠지면 요청이 꺼지고 다시 고르라고 한다', () => {
    const memo = option('c', 'memo_differs');
    const picked = togglePick([], memo, all);
    const stillPickable = [memo].filter(
      (entry) =>
        picked.includes(entry.shipmentId) &&
        optionCard(entry, noOverride).pickable
    );

    expect(stillPickable).toEqual([]);
    expect(step2Blocker({ ...ready, pickedCount: stillPickable.length })).toBe(
      '같이 보낼 주문이 없어졌어요. 다시 골라 주세요'
    );
  });

  it('draft 원본에 계획이 확정된 주문이 섞이면 재개방 권한 없이는 요청이 꺼진다', () => {
    const sources = [shipment('a'), shipment('p', { status: 'planned' })];
    const needsReopen = needsReopenPermission(sources, false);

    expect(needsReopen).toBe(true);
    expect(step2Blocker({ ...ready, needsReopen })).toBe(
      '출고 준비가 시작된 주문이 있어 합치려면 출고 재개방 권한이 필요해요'
    );
    expect(needsReopenPermission(sources, true)).toBe(false);
    expect(needsReopenPermission([shipment('a'), shipment('b')], false)).toBe(
      false
    );
  });

  it('응답을 받지 못한 요청이 있으면 새 요청을 막는다', () => {
    expect(step2Blocker({ ...ready, hasLostCommand: true })).toBe(
      '응답을 받지 못한 요청을 먼저 다시 보내 주세요'
    );
  });
});

describe('2단계 진행 순서', () => {
  it('draft 이고 배치·송장이 없으면 순서를 보이지 않는다', () => {
    expect(needsUnwindSteps(shipment('a'))).toBe(false);
  });

  it('배치에 들어 있거나 송장이 있거나 draft 가 아니면 순서를 보인다', () => {
    expect(needsUnwindSteps(shipment('a', { batchId: 'batch-1' }))).toBe(true);
    expect(needsUnwindSteps(shipment('a', { waybillTrackingNo: 'T1' }))).toBe(
      true
    );
    expect(needsUnwindSteps(shipment('a', { status: 'planned' }))).toBe(true);
  });
});

describe('요청', () => {
  it('요청은 recipientSourceShipmentId 로 보낸다', () => {
    const data = buildConsolidationRequest({
      source: shipment('a'),
      picked: [option('c', 'memo_differs')],
      memoFrom: 'c',
      reason: '고객 요청',
    });

    expect(data.recipientSourceShipmentId).toBe('c');
    expect(data.recipientSnapshot).toBeUndefined();
  });

  it('버전 409 면 다시 읽어야 한다고 판정한다', () => {
    const stale = (code: string) => ({
      response: { status: 409, data: { code, message: 'stale' } },
    });

    expect(
      isStaleVersionConflict(stale('SHIPMENT_STALE_MANIFEST_VERSION'))
    ).toBe(true);
    expect(
      isStaleVersionConflict(stale('SHIPMENT_STALE_RESERVATION_VERSION'))
    ).toBe(true);
    expect(isStaleVersionConflict(stale('CONSOLIDATION_BLOCKED'))).toBe(false);
    expect(
      isStaleVersionConflict({
        response: {
          status: 400,
          data: { code: 'SHIPMENT_STALE_MANIFEST_VERSION' },
        },
      })
    ).toBe(false);
  });

  it('새 요청은 매번 새 멱등키를 쓴다', () => {
    const data = buildConsolidationRequest({
      source: shipment('a'),
      picked: [option('b', 'ok')],
      memoFrom: 'a',
      reason: '고객 요청',
    });

    expect(freshCommand(data).idempotencyKey).not.toBe(
      freshCommand(data).idempotencyKey
    );
  });

  it('응답을 잃은 뒤 후보 버전이 바뀌어도 처음 본문과 키를 그대로 다시 보낸다', () => {
    const sent = freshCommand(
      buildConsolidationRequest({
        source: shipment('a'),
        picked: [option('b', 'ok')],
        memoFrom: 'a',
        reason: '고객 요청',
      })
    );
    const lost = keptAfterFailure(sent, new Error('Network Error'));
    const refetched = buildConsolidationRequest({
      source: shipment('a', { manifestVersion: 2 }),
      picked: [option('b', 'ok')],
      memoFrom: 'a',
      reason: '고객 요청',
    });

    expect(lost).toBe(sent);
    expect(lost?.data.sources[0].expectedManifestVersion).toBe(1);
    expect(refetched.sources[0].expectedManifestVersion).toBe(2);
  });

  it('클라이언트가 500 으로 바꾼 응답 없음도 보존한다', () => {
    const sent = freshCommand(
      buildConsolidationRequest({
        source: shipment('a'),
        picked: [option('b', 'ok')],
        memoFrom: 'a',
        reason: '고객 요청',
      })
    );

    expect(keptAfterFailure(sent, { statusCode: 500, message: 'x' })).toBe(
      sent
    );
  });

  it('서버가 판정한 실패는 보존하지 않는다', () => {
    const sent = freshCommand(
      buildConsolidationRequest({
        source: shipment('a'),
        picked: [option('b', 'ok')],
        memoFrom: 'a',
        reason: '고객 요청',
      })
    );

    expect(
      keptAfterFailure(sent, {
        response: {
          status: 409,
          data: { code: 'SHIPMENT_STALE_MANIFEST_VERSION' },
        },
      })
    ).toBeNull();
    expect(
      keptAfterFailure(sent, { statusCode: 403, message: 'x' })
    ).toBeNull();
  });
});
