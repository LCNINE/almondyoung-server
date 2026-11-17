import {
  planLineItemReservation,
  planReservationBatch,
  resolveManaged,
  resultsAfterWriteFailure,
  writeFailureMessage,
  type LineItemContext,
} from '../plan';

const managed = { inventoryItemId: 'iitem_1', locationId: 'sloc_1' };

describe('planLineItemReservation', () => {
  it('기존 3 → 목표 0: 그 행을 지운다', () => {
    expect(planLineItemReservation([{ id: 'r1', quantity: 3 }], 0, true, managed)).toEqual({
      delete: ['r1'],
      outcome: 'set',
    });
  });

  it('기존 3 → 목표 1: 그 행을 1 로 고친다', () => {
    expect(planLineItemReservation([{ id: 'r1', quantity: 3 }], 1, true, managed)).toEqual({
      update: { id: 'r1', quantity: 1 },
      delete: [],
      outcome: 'set',
    });
  });

  it('기존 없음 → 목표 2: 2 로 만든다', () => {
    expect(planLineItemReservation([], 2, true, managed)).toEqual({
      create: { quantity: 2 },
      delete: [],
      outcome: 'set',
    });
  });

  it('기존 2+1 → 목표 3: 합이 같으면 그대로 둔다', () => {
    expect(
      planLineItemReservation(
        [
          { id: 'r1', quantity: 2 },
          { id: 'r2', quantity: 1 },
        ],
        3,
        true,
        managed,
      ),
    ).toEqual({ delete: [], outcome: 'unchanged' });
  });

  it('기존 2+1 → 목표 2: 첫 행에 몰고 나머지를 지운다', () => {
    expect(
      planLineItemReservation(
        [
          { id: 'r1', quantity: 2 },
          { id: 'r2', quantity: 1 },
        ],
        2,
        true,
        managed,
      ),
    ).toEqual({ update: { id: 'r1', quantity: 2 }, delete: ['r2'], outcome: 'set' });
  });

  it('기존 2+1 → 목표 0: 전부 지운다', () => {
    expect(
      planLineItemReservation(
        [
          { id: 'r1', quantity: 2 },
          { id: 'r2', quantity: 1 },
        ],
        0,
        true,
        managed,
      ),
    ).toEqual({ delete: ['r1', 'r2'], outcome: 'set' });
  });

  it('managed 가 null 이면 not_managed 이고 아무것도 쓰지 않는다', () => {
    expect(planLineItemReservation([{ id: 'r1', quantity: 3 }], 0, true, null)).toEqual({
      delete: [],
      outcome: 'not_managed',
    });
  });

  it('기존 3 → 목표 1 · 감소 금지: deferred 이고 아무것도 쓰지 않는다', () => {
    expect(planLineItemReservation([{ id: 'r1', quantity: 3 }], 1, false, managed)).toEqual({
      delete: [],
      outcome: 'deferred',
    });
  });

  it('기존 2+1 → 목표 2 · 감소 금지: 합이 줄어드는 것이라 deferred', () => {
    expect(
      planLineItemReservation(
        [
          { id: 'r1', quantity: 2 },
          { id: 'r2', quantity: 1 },
        ],
        2,
        false,
        managed,
      ).outcome,
    ).toBe('deferred');
  });

  it('기존 1 → 목표 3 · 감소 금지: 늘리는 쓰기는 바로 한다', () => {
    expect(planLineItemReservation([{ id: 'r1', quantity: 1 }], 3, false, managed)).toEqual({
      update: { id: 'r1', quantity: 3 },
      delete: [],
      outcome: 'set',
    });
  });

  it('기존 없음 → 목표 3 · 감소 금지: 만든다', () => {
    expect(planLineItemReservation([], 3, false, managed)).toEqual({
      create: { quantity: 3 },
      delete: [],
      outcome: 'set',
    });
  });
});

const ctx = (over: Partial<LineItemContext> = {}): LineItemContext => ({
  lineItemId: 'li_1',
  variantId: 'variant_1',
  manageInventory: true,
  inventoryItems: [{ inventoryItemId: 'iitem_1', requiredQuantity: 1 }],
  locationIds: ['sloc_1'],
  existing: [],
  ...over,
});

describe('resolveManaged', () => {
  it('variant 가 없는 줄(교환 대체 줄)은 not_managed', () => {
    expect(resolveManaged(ctx({ variantId: null, inventoryItems: [] }))).toEqual({ kind: 'not_managed' });
  });

  it('manage_inventory=false 면 not_managed', () => {
    expect(resolveManaged(ctx({ manageInventory: false }))).toEqual({ kind: 'not_managed' });
  });

  it('인벤토리 항목이 없으면 not_managed', () => {
    expect(resolveManaged(ctx({ inventoryItems: [] }))).toEqual({ kind: 'not_managed' });
  });

  it('인벤토리 항목이 둘 이상이면 error — 어느 쪽에 잡을지 모른다', () => {
    const resolved = resolveManaged(
      ctx({
        inventoryItems: [
          { inventoryItemId: 'iitem_1', requiredQuantity: 1 },
          { inventoryItemId: 'iitem_2', requiredQuantity: 1 },
        ],
      }),
    );
    expect(resolved.kind).toBe('error');
  });

  it('판매채널의 재고 위치가 하나가 아니면 error', () => {
    expect(resolveManaged(ctx({ locationIds: [] })).kind).toBe('error');
    expect(resolveManaged(ctx({ locationIds: ['sloc_1', 'sloc_2'] })).kind).toBe('error');
  });

  it('variant·항목·위치가 하나씩이면 managed', () => {
    expect(resolveManaged(ctx({ inventoryItems: [{ inventoryItemId: 'iitem_1', requiredQuantity: 2 }] }))).toEqual({
      kind: 'managed',
      managed: { inventoryItemId: 'iitem_1', locationId: 'sloc_1' },
      requiredQuantity: 2,
    });
  });
});

describe('planReservationBatch', () => {
  const stocked = new Set(['iitem_1:sloc_1']);

  it('줄마다 결과를 내고, 쓰기는 한 묶음으로 모은다', () => {
    const contexts = new Map<string, LineItemContext>([
      ['li_new', ctx({ lineItemId: 'li_new' })],
      ['li_dec', ctx({ lineItemId: 'li_dec', existing: [{ id: 'r_dec', quantity: 3 }] })],
      [
        'li_merge',
        ctx({
          lineItemId: 'li_merge',
          existing: [
            { id: 'r_m1', quantity: 2 },
            { id: 'r_m2', quantity: 1 },
          ],
        }),
      ],
      ['li_exchange', ctx({ lineItemId: 'li_exchange', variantId: null, inventoryItems: [] })],
    ]);

    const batch = planReservationBatch(
      [
        { line_item_id: 'li_new', quantity: 2, allow_decrease: false },
        { line_item_id: 'li_dec', quantity: 1, allow_decrease: false },
        { line_item_id: 'li_merge', quantity: 2, allow_decrease: true },
        { line_item_id: 'li_exchange', quantity: 0, allow_decrease: true },
        { line_item_id: 'li_missing', quantity: 1, allow_decrease: true },
      ],
      contexts,
      stocked,
    );

    expect(batch.results).toEqual([
      { line_item_id: 'li_new', outcome: 'set', quantity_before: 0, quantity_after: 2 },
      { line_item_id: 'li_dec', outcome: 'deferred', quantity_before: 3, quantity_after: 3 },
      { line_item_id: 'li_merge', outcome: 'set', quantity_before: 3, quantity_after: 2 },
      { line_item_id: 'li_exchange', outcome: 'not_managed', quantity_before: 0, quantity_after: 0 },
      { line_item_id: 'li_missing', outcome: 'not_found', quantity_before: 0, quantity_after: 0 },
    ]);
    expect(batch.creates).toEqual([
      expect.objectContaining({
        line_item_id: 'li_new',
        inventory_item_id: 'iitem_1',
        location_id: 'sloc_1',
        quantity: 2,
        allow_backorder: true,
      }),
    ]);
    expect(batch.updates).toEqual([{ id: 'r_m1', quantity: 2, allow_backorder: true }]);
    expect(batch.deletes).toEqual(['r_m2']);
  });

  it('required_quantity 를 반영한다 — 판매 단위 2 × 2 = 인벤토리 4', () => {
    const contexts = new Map([
      [
        'li_1',
        ctx({
          inventoryItems: [{ inventoryItemId: 'iitem_1', requiredQuantity: 2 }],
          existing: [{ id: 'r1', quantity: 2 }],
        }),
      ],
    ]);
    const batch = planReservationBatch(
      [{ line_item_id: 'li_1', quantity: 2, allow_decrease: true }],
      contexts,
      stocked,
    );
    expect(batch.updates).toEqual([{ id: 'r1', quantity: 4, allow_backorder: true }]);
    expect(batch.results[0]).toEqual({ line_item_id: 'li_1', outcome: 'set', quantity_before: 1, quantity_after: 2 });
  });

  it('만들어야 하는데 그 위치에 인벤토리 레벨이 없으면 그 줄만 error — 묶음 전체가 터지지 않게', () => {
    const contexts = new Map([['li_1', ctx()]]);
    const batch = planReservationBatch(
      [{ line_item_id: 'li_1', quantity: 1, allow_decrease: true }],
      contexts,
      new Set<string>(),
    );
    expect(batch.results[0]).toMatchObject({
      line_item_id: 'li_1',
      outcome: 'error',
      quantity_before: 0,
      quantity_after: 0,
    });
    expect(batch.results[0].message).toBeTruthy();
    expect(batch.creates).toEqual([]);
  });

  it('관리 판정이 error 인 줄은 쓰지 않고 지금 값을 그대로 보고한다', () => {
    const contexts = new Map([['li_1', ctx({ locationIds: [], existing: [{ id: 'r1', quantity: 2 }] })]]);
    const batch = planReservationBatch(
      [{ line_item_id: 'li_1', quantity: 0, allow_decrease: true }],
      contexts,
      stocked,
    );
    expect(batch.results[0]).toMatchObject({ outcome: 'error', quantity_before: 2, quantity_after: 2 });
    expect(batch.deletes).toEqual([]);
  });
});

describe('resultsAfterWriteFailure', () => {
  it('쓰기가 계획됐던 줄만 error 이고, 수량은 다시 읽은 지금 값이다', () => {
    const contexts = new Map<string, LineItemContext>([
      ['li_set', ctx({ lineItemId: 'li_set', existing: [{ id: 'r1', quantity: 1 }] })],
      ['li_same', ctx({ lineItemId: 'li_same', existing: [{ id: 'r2', quantity: 2 }] })],
      ['li_wait', ctx({ lineItemId: 'li_wait', existing: [{ id: 'r3', quantity: 3 }] })],
      ['li_exchange', ctx({ lineItemId: 'li_exchange', variantId: null, inventoryItems: [] })],
    ]);
    const replan = planReservationBatch(
      [
        { line_item_id: 'li_set', quantity: 4, allow_decrease: true },
        { line_item_id: 'li_same', quantity: 2, allow_decrease: true },
        { line_item_id: 'li_wait', quantity: 1, allow_decrease: false },
        { line_item_id: 'li_exchange', quantity: 0, allow_decrease: true },
        { line_item_id: 'li_missing', quantity: 1, allow_decrease: true },
      ],
      contexts,
      new Set(['iitem_1:sloc_1']),
    );

    expect(resultsAfterWriteFailure(replan, 'boom')).toEqual([
      { line_item_id: 'li_set', outcome: 'error', quantity_before: 1, quantity_after: 1, message: 'boom' },
      { line_item_id: 'li_same', outcome: 'unchanged', quantity_before: 2, quantity_after: 2 },
      { line_item_id: 'li_wait', outcome: 'deferred', quantity_before: 3, quantity_after: 3 },
      { line_item_id: 'li_exchange', outcome: 'not_managed', quantity_before: 0, quantity_after: 0 },
      { line_item_id: 'li_missing', outcome: 'not_found', quantity_before: 0, quantity_after: 0 },
    ]);
  });

  it('계획 단계에서 이미 error 였던 줄은 원래 메시지를 지킨다', () => {
    const contexts = new Map([['li_1', ctx({ locationIds: [] })]]);
    const replan = planReservationBatch(
      [{ line_item_id: 'li_1', quantity: 1, allow_decrease: true }],
      contexts,
      new Set(),
    );
    const [result] = resultsAfterWriteFailure(replan, 'boom');
    expect(result.outcome).toBe('error');
    expect(result.message).not.toBe('boom');
  });
});

describe('writeFailureMessage', () => {
  it('Error·{message} 객체·문자열·그 밖의 값에서 읽을 문장을 꺼낸다', () => {
    expect(writeFailureMessage(new Error('boom'))).toBe('boom');
    expect(writeFailureMessage({ message: 'workflow boom', name: 'x' })).toBe('workflow boom');
    expect(writeFailureMessage('plain')).toBe('plain');
    expect(writeFailureMessage({ code: 1 })).toBe('{"code":1}');
    expect(writeFailureMessage(undefined)).toBe('undefined');
  });
});
