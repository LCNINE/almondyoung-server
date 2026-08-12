import { MedusaError } from '@medusajs/framework/utils';
import { toCartLockConflict } from '../cart-lock-conflict';

describe('toCartLockConflict', () => {
  it('락 실패를 conflict 로 올린다', () => {
    const converted = toCartLockConflict(new Error('Failed to acquire lock for key "cart_01JABC"'));

    expect(converted).toBeInstanceOf(MedusaError);
    expect((converted as MedusaError).type).toBe(MedusaError.Types.CONFLICT);
  });

  it('이미 MedusaError 로 분류된 건 건드리지 않는다', () => {
    const original = new MedusaError(MedusaError.Types.NOT_FOUND, 'ShippingMethod with id: casm_1 was not found');

    expect(toCartLockConflict(original)).toBe(original);
  });

  it('다른 에러는 그대로 통과시킨다', () => {
    const original = new Error('Some variant does not have the required inventory');

    expect(toCartLockConflict(original)).toBe(original);
  });

  it('에러가 아닌 값도 그대로 통과시킨다', () => {
    expect(toCartLockConflict('boom')).toBe('boom');
    expect(toCartLockConflict(undefined)).toBeUndefined();
  });
});

describe('realm 을 넘어온 에러', () => {
  // 워크플로 엔진을 거친 에러는 instanceof Error 가 false 로 나온다 (로컬 실측).
  // 모양으로 판정하지 않으면 락 실패가 그대로 500 unknown 으로 나간다.
  it('instanceof 가 깨진 에러도 conflict 로 올린다', () => {
    const crossRealm = Object.assign(Object.create(null), {
      name: 'Error',
      message: 'Failed to acquire lock for key "cart_01JABC"',
    });

    expect(crossRealm instanceof Error).toBe(false);

    const converted = toCartLockConflict(crossRealm);
    expect((converted as MedusaError).type).toBe(MedusaError.Types.CONFLICT);
  });
});
