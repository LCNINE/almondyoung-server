import { reversalOnHandDecrement, reversalTransitionType } from './stock-event.store';
import { StockStateEnum } from '../../schema/enum-values';

const base: {
  skuId: string;
  fromWarehouseId: string | null;
  toWarehouseId: string | null;
  fromState: StockStateEnum | null;
  toState: StockStateEnum | null;
  quantity: number;
} = {
  skuId: 'sku-1',
  fromWarehouseId: null,
  toWarehouseId: null,
  fromState: null,
  toState: null,
  quantity: 10,
};

describe('reversalOnHandDecrement', () => {
  // 감소 방향: 원 이벤트가 null→ON_HAND (RECEIVE, ADJUST_UP, REWORK_GOOD). 역분개가 to-창고 ON_HAND 감소.
  it('null→ON_HAND 이벤트(RECEIVE/ADJUST_UP) 역분개는 to-창고 감소', () => {
    expect(reversalOnHandDecrement({ ...base, toWarehouseId: 'wh-1', toState: 'ON_HAND' })).toEqual({
      skuId: 'sku-1',
      warehouseId: 'wh-1',
      quantity: 10,
    });
  });
  // 증가 방향: 원 이벤트가 ON_HAND→null·비-ON_HAND (SHIP, ADJUST_DOWN, SCRAP). 역분개는 ON_HAND 증가 → 가드 면제.
  it('ON_HAND→null 이벤트(SHIP/ADJUST_DOWN/SCRAP) 역분개는 증가 방향 → null', () => {
    expect(reversalOnHandDecrement({ ...base, fromWarehouseId: 'wh-1', fromState: 'ON_HAND' })).toBeNull();
  });
  it('창고내 MOVE(W:ON_HAND→W:ON_HAND) 역분개는 순변화 0 → null', () => {
    expect(
      reversalOnHandDecrement({
        ...base,
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-1',
        fromState: 'ON_HAND',
        toState: 'ON_HAND',
      }),
    ).toBeNull();
  });
  it('창고간 MOVE(W1:ON_HAND→W2:ON_HAND) 역분개는 W2(=to) 감소', () => {
    expect(
      reversalOnHandDecrement({
        ...base,
        fromWarehouseId: 'wh-1',
        toWarehouseId: 'wh-2',
        fromState: 'ON_HAND',
        toState: 'ON_HAND',
      }),
    ).toEqual({ skuId: 'sku-1', warehouseId: 'wh-2', quantity: 10 });
  });
  it('toState=ON_HAND 이나 toWarehouseId 없음(malformed) → null', () => {
    expect(reversalOnHandDecrement({ ...base, toWarehouseId: null, toState: 'ON_HAND' })).toBeNull();
  });
});

describe('reversalTransitionType', () => {
  it('반품 입고 역분개는 입고 역분개처럼 ADJUST_DOWN', () => {
    expect(reversalTransitionType('RETURN_RECEIVE')).toBe('ADJUST_DOWN');
  });
  // 같은 위치 상태 전이는 MOVE 가 이미 담는다(transferShip 이 ON_HAND→IN_TRANSFER 를 MOVE 로 쓴다).
  it('반품 합격·불합격 역분개는 같은 위치 상태 전이라 MOVE', () => {
    expect(reversalTransitionType('RETURN_ACCEPT')).toBe('MOVE');
    expect(reversalTransitionType('RETURN_REJECT')).toBe('MOVE');
  });
  it('기존 전이의 역분개 타입은 그대로', () => {
    expect(reversalTransitionType('RECEIVE')).toBe('ADJUST_DOWN');
    expect(reversalTransitionType('SHIP')).toBe('ADJUST_UP');
    expect(reversalTransitionType('MOVE')).toBe('MOVE');
  });
});
