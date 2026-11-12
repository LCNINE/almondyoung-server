import {
  orderShipments,
  ownerLabel,
  recallConfirmText,
  shipmentActionsFor,
  showsWaybillActions,
} from './shipment-owner';

const SUPPLIER = 'ab12cd34-0000-0000-0000-000000000000';
const WAREHOUSE = 'ef56ab78-0000-0000-0000-000000000000';

describe('shipmentActionsFor', () => {
  it('입점사 상자는 되돌리기만 연다', () => {
    expect(
      shipmentActionsFor({ supplierId: SUPPLIER, status: 'draft' })
    ).toEqual(['recall']);
  });
  it('계획 전 창고 상자는 넷 다 연다', () => {
    expect(shipmentActionsFor({ supplierId: null, status: 'draft' })).toEqual([
      'split',
      'recipient',
      'plan',
      'recall',
    ]);
  });
  it('계획을 확정했거나 출고한 상자는 나누기·수령인·계획을 열지 않는다 — 서버가 계획 전만 받는다', () => {
    for (const status of ['planned', 'shipped', 'superseded']) {
      expect(shipmentActionsFor({ supplierId: null, status })).toEqual([
        'recall',
      ]);
    }
  });
});

describe('showsWaybillActions', () => {
  it('입점사 상자는 운송장 버튼을 숨긴다 — 서버가 전부 409', () => {
    expect(showsWaybillActions({ supplierId: SUPPLIER })).toBe(false);
  });
  it('창고 상자는 보인다', () => {
    expect(showsWaybillActions({ supplierId: null })).toBe(true);
  });
});

describe('recallConfirmText', () => {
  it('창고는 상자를 돌려받았는지 묻는다', () => {
    expect(recallConfirmText(false)).toBe(
      '고른 출고의 상자를 창고에서 실제로 돌려받았어요.'
    );
  });
  it('입점사는 N7 문구', () => {
    expect(recallConfirmText(true)).toBe(
      '입점사와 확인했습니다 — 이 송장은 잘못 반영되었거나 아직 보내지 않았습니다.'
    );
  });
});

describe('ownerLabel', () => {
  it('창고 상자는 창고 출고 (warehouseId 가 null 이어도 supplierId 로만 가른다)', () => {
    expect(
      ownerLabel({ supplierId: null, warehouseId: WAREHOUSE }, undefined)
    ).toBe('창고 출고');
    expect(ownerLabel({ supplierId: null, warehouseId: null }, undefined)).toBe(
      '창고 출고'
    );
  });
  it('입점사 상자는 이름', () => {
    expect(
      ownerLabel({ supplierId: SUPPLIER, warehouseId: null }, '가나다상사')
    ).toBe('입점사 직배 · 가나다상사');
  });
  it('이름을 모르면 입점사 직배만', () => {
    expect(
      ownerLabel({ supplierId: SUPPLIER, warehouseId: null }, undefined)
    ).toBe('입점사 직배');
  });
});

describe('orderShipments', () => {
  const box = (id: string, status: string) => ({ id, status });

  it('합쳐져 쓰지 않는 상자는 뒤로 보내고 순서는 그대로 둔다', () => {
    const result = orderShipments([
      box('a', 'superseded'),
      box('b', 'draft'),
      box('c', 'superseded'),
      box('d', 'planned'),
    ]);

    expect(result.active.map((s) => s.id)).toEqual(['b', 'd']);
    expect(result.retired.map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('쓰지 않는 상자가 없으면 retired 는 비어 있다', () => {
    expect(orderShipments([box('a', 'draft')]).retired).toEqual([]);
  });
});
