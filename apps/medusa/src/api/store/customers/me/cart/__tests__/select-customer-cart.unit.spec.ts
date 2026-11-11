import { linesToMove, selectCustomerCart } from '../select-customer-cart';

const line = (id: string, variant_id: string, metadata?: Record<string, unknown>) => ({ id, variant_id, quantity: 1, metadata });

describe('selectCustomerCart', () => {
  it('일반 장바구니 주문 뒤에는 그보다 먼저 손댄 옛 카트를 되살리지 않는다', () => {
    const { target, mergeSources } = selectCustomerCart([
      { id: 'old', updated_at: '2026-07-23', items: [line('l1', 'eyepatch')] },
      { id: 'bought', updated_at: '2026-11-11T04:50Z', completed_at: '2026-11-11T04:50Z', metadata: { cart_kind: 'shopping' } },
    ]);

    expect(target).toBeNull();
    expect(mergeSources).toEqual([]);
  });

  it('주문 뒤에 만든 카트는 복구하고 옛 카트는 합치지 않는다', () => {
    const { target, mergeSources } = selectCustomerCart([
      { id: 'old', updated_at: '2026-07-23', items: [line('l1', 'eyepatch')] },
      { id: 'bought', completed_at: '2026-11-11T04:50Z', metadata: { cart_kind: 'shopping' } },
      { id: 'new', updated_at: '2026-11-11T05:00Z', metadata: { cart_kind: 'shopping' }, items: [line('l2', 'brush')] },
    ]);

    expect(target?.id).toBe('new');
    expect(mergeSources).toEqual([]);
  });

  it('바로구매·부분 결제 주문은 기준이 아니라서 담아 둔 장바구니가 남는다', () => {
    const { target } = selectCustomerCart([
      { id: 'main', updated_at: '2026-11-01', metadata: { cart_kind: 'shopping' }, items: [line('l1', 'a')] },
      { id: 'buy-now', completed_at: '2026-11-05', metadata: { cart_kind: 'buy_now' } },
      { id: 'partial', completed_at: '2026-11-06', metadata: { source_cart_id: 'main' } },
    ]);

    expect(target?.id).toBe('main');
  });

  it('표시 없는 옛 카트의 완료는 기준이 되지 않는다', () => {
    const { target } = selectCustomerCart([
      { id: 'main', updated_at: '2026-11-01', items: [line('l1', 'a')] },
      { id: 'legacy-done', completed_at: '2026-11-05' },
    ]);

    expect(target?.id).toBe('main');
  });

  it('버려진 바로구매·파생·이미 합친 카트는 본체가 되지 않는다', () => {
    const { target, mergeSources } = selectCustomerCart([
      { id: 'main', updated_at: '2026-11-01', items: [line('l1', 'a')] },
      { id: 'buy-now', updated_at: '2026-11-10', metadata: { cart_kind: 'buy_now' }, items: [line('l2', 'b')] },
      { id: 'preview', updated_at: '2026-11-10', metadata: { is_shipping_preview: true, source_cart_id: 'main' }, items: [line('l3', 'c')] },
      { id: 'merged', updated_at: '2026-11-10', metadata: { merged_into: 'main' }, items: [line('l4', 'd')] },
    ]);

    expect(target?.id).toBe('main');
    expect(mergeSources).toEqual([]);
  });

  it('후보가 여럿이면 최신이 본체이고 30일 안에 손댄, 상품이 있는 나머지만 합칠 대상이다', () => {
    const now = new Date('2026-11-11').getTime();
    const { target, mergeSources } = selectCustomerCart(
      [
        { id: 'a', updated_at: '2026-11-01', items: [line('l1', 'x')] },
        { id: 'b', updated_at: '2026-11-03', items: [] },
        { id: 'c', updated_at: '2026-11-02', items: [line('l2', 'y')] },
        { id: 'june', updated_at: '2026-06-17', items: [line('l3', 'z')] },
      ],
      now,
    );

    expect(target?.id).toBe('b');
    expect(mergeSources.map((cart) => cart.id)).toEqual(['c', 'a']);
  });

  it('shopping 표시가 있어도 파생 카트의 완료는 기준이 아니다', () => {
    const { target } = selectCustomerCart([
      { id: 'main', updated_at: '2026-11-01', items: [line('l1', 'a')] },
      { id: 'derived', completed_at: '2026-11-05', metadata: { cart_kind: 'shopping', source_cart_id: 'main' } },
    ]);

    expect(target?.id).toBe('main');
  });

  it('부분 결제가 진행 중인 카트는 합치지 않는다', () => {
    const now = new Date('2026-11-11T12:00Z').getTime();
    const { mergeSources } = selectCustomerCart(
      [
        { id: 'target', updated_at: '2026-11-11T11:00Z', items: [] },
        { id: 'pending', updated_at: '2026-11-11T09:00Z', items: [line('l1', 'a')] },
        { id: 'checkout', updated_at: '2026-11-11T10:00Z', completed_at: '2026-11-11T10:00Z', metadata: { source_cart_id: 'pending' } },
      ],
      now,
    );

    expect(mergeSources).toEqual([]);
  });

  it('본체는 30일보다 오래됐어도 그대로 복구한다', () => {
    const { target } = selectCustomerCart([{ id: 'june', updated_at: '2026-06-17', items: [line('l1', 'x')] }], new Date('2026-11-11').getTime());

    expect(target?.id).toBe('june');
  });
});

describe('linesToMove', () => {
  it('본체에 같은 variant·metadata 가 있으면 옮기지 않고, metadata 가 다르면 따로 옮긴다', () => {
    const target = { id: 't', items: [line('t1', 'x'), line('t2', 'card', { design: 1 })] };
    const source = {
      id: 's',
      items: [line('s1', 'x'), line('s2', 'card', { design: 2 }), line('s3', 'card', { design: 1 }), line('s4', 'z'), line('s5', 'z')],
    };

    expect(linesToMove(target, source).map((l) => l.id)).toEqual(['s2', 's4']);
  });
});
