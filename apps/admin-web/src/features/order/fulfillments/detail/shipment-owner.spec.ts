import {
  ownerLabel,
  recallConfirmText,
  shipmentActionsFor,
} from './shipment-owner';

const SUPPLIER = 'ab12cd34-0000-0000-0000-000000000000';
const WAREHOUSE = 'ef56ab78-0000-0000-0000-000000000000';

describe('shipmentActionsFor', () => {
  it('입점사 상자는 되돌리기만 연다', () => {
    expect(shipmentActionsFor({ supplierId: SUPPLIER })).toEqual(['recall']);
  });
  it('창고 상자는 넷 다 연다', () => {
    expect(shipmentActionsFor({ supplierId: null })).toEqual([
      'split',
      'recipient',
      'plan',
      'recall',
    ]);
  });
});

describe('recallConfirmText', () => {
  it('창고는 지금 문구 그대로', () => {
    expect(recallConfirmText(false)).toBe(
      '선택한 출고 시도의 실물 패키지가 창고에 회수되었음을 확인합니다.'
    );
  });
  it('입점사는 N7 문구', () => {
    expect(recallConfirmText(true)).toBe(
      '입점사와 확인했습니다 — 이 송장은 잘못 반영되었거나 아직 보내지 않았습니다.'
    );
  });
});

describe('ownerLabel', () => {
  it('창고 상자는 창고 짧은 id (warehouseId 가 null 이어도 supplierId 로만 가른다)', () => {
    expect(
      ownerLabel({ supplierId: null, warehouseId: WAREHOUSE }, undefined)
    ).toBe('창고 ef56ab78…');
    expect(ownerLabel({ supplierId: null, warehouseId: null }, undefined)).toBe(
      '창고 -'
    );
  });
  it('입점사 상자는 이름', () => {
    expect(
      ownerLabel({ supplierId: SUPPLIER, warehouseId: null }, '가나다상사')
    ).toBe('입점사 가나다상사');
  });
  it('이름을 모르면 짧은 id', () => {
    expect(
      ownerLabel({ supplierId: SUPPLIER, warehouseId: null }, undefined)
    ).toBe('입점사 ab12cd34…');
  });
});
