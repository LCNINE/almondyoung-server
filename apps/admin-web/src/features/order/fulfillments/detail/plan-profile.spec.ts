import type { ShipmentAdminLine } from '@/lib/types/dto/fulfillment';
import {
  defaultSplitGroupKey,
  planProfileState,
  profileGroups,
} from './plan-profile';

function line(
  id: string,
  profile: ShipmentAdminLine['deliveryProfile'],
  qty = 1
): ShipmentAdminLine {
  return {
    id,
    fulfillmentOrderId: 'fo',
    fulfillmentOrderItemId: `item-${id}`,
    skuId: `sku-${id}`,
    deliveryProfile: profile,
    qty,
    reservedQty: qty,
    inspectedQty: 0,
    lineVersion: 1,
    origin: null,
    reservations: [],
  };
}

const A = { id: 'a', name: '가' };
const B = { id: 'b', name: '나' };

describe('planProfileState', () => {
  it('모두 같은 프로필이면 그 프로필', () => {
    expect(planProfileState([line('1', A), line('2', A)])).toEqual({
      kind: 'single',
      profile: A,
    });
  });

  it('섞였거나 하나라도 없으면 막는다 — 상자 확정과 같은 규칙', () => {
    expect(planProfileState([line('1', A), line('2', B)]).kind).toBe('blocked');
    expect(planProfileState([line('1', A), line('2', null)]).kind).toBe(
      'blocked'
    );
    expect(planProfileState([line('1', null)]).kind).toBe('blocked');
  });

  it('줄에 프로필이 실리지 않았거나 빈 상자면 판단하지 않는다', () => {
    const { deliveryProfile: _omit, ...legacy } = line('1', A);
    expect(planProfileState([legacy, line('2', B)])).toEqual({
      kind: 'unknown',
    });
    expect(planProfileState([])).toEqual({ kind: 'unknown' });
  });
});

describe('profileGroups', () => {
  it('처음 나온 순서로 묶고 수량을 더한다', () => {
    const groups = profileGroups([
      line('1', B, 2),
      line('2', A),
      line('3', B, 3),
    ]);
    expect(
      groups?.map((g) => [g.key, g.lines.map((l) => l.id), g.qty])
    ).toEqual([
      ['b', ['1', '3'], 5],
      ['a', ['2'], 1],
    ]);
  });
});

describe('defaultSplitGroupKey', () => {
  it('첫 줄의 묶음은 남기고, 프로필 있는 다음 묶음을 보낸다', () => {
    const groups = profileGroups([line('1', A), line('2', null), line('3', B)]);
    expect(defaultSplitGroupKey(groups ?? [])).toBe('b');
  });

  it('보낼 수 있는 묶음이 프로필 없음뿐이면 그것을 고른다', () => {
    const groups = profileGroups([line('1', A), line('2', null)]);
    expect(defaultSplitGroupKey(groups ?? [])).toBe('no-profile');
  });
});
