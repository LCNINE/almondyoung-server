import { Warehouse } from '../../schema/inventory.schema';
import { WarehouseMapper } from './warehouse.mapper';

function warehouseRow(overrides: Partial<Warehouse> = {}): Warehouse {
  return {
    id: '019d0001-0001-7000-a000-000000000001',
    name: '부천 물류창고',
    type: 'domestic',
    isSellable: true,
    location: '부천시',
    supportedPickingStrategies: ['discrete'],
    createdAt: new Date('2026-08-24T00:00:00.000Z'),
    updatedAt: new Date('2026-08-24T00:00:00.000Z'),
    ...overrides,
  };
}

describe('WarehouseMapper', () => {
  // 응답에 없으면 어드민 창고 화면이 현재 판매 여부를 그릴 수 없다 — 켜고 끄는
  // 스위치가 무엇을 뒤집는지 모른 채 눌리게 된다.
  it('판매 창고 여부를 응답에 싣는다', () => {
    expect(WarehouseMapper.toDto(warehouseRow({ isSellable: true }))).toMatchObject({ isSellable: true });
  });

  // false 를 falsy 라는 이유로 흘리면(?? 나 || 로 정규화) 비판매 창고가 판매 창고로
  // 보인다. 이번 변경에서 가장 비싼 실수라 명시적으로 고정한다.
  it('비판매 창고의 false 를 그대로 싣는다', () => {
    expect(WarehouseMapper.toDto(warehouseRow({ isSellable: false }))).toMatchObject({ isSellable: false });
  });
});
