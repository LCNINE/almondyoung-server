// apps/medusa/integration-tests/http/line-item-reservations.spec.ts
import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { FakeWallet, WALLET_BASE_URL, setupCommerce, placeOrder, Commerce } from './fixtures/partial-cancel-fixture';

jest.setTimeout(300 * 1000);
process.env.WALLET_BASE_URL = WALLET_BASE_URL;
process.env.WALLET_API_KEY = 'test-wallet-key';
const wallet = new FakeWallet();

type Item = { line_item_id: string; quantity: number; allow_decrease: boolean };
type Result = { line_item_id: string; outcome: string; quantity_before: number; quantity_after: number };

/**
 * 줄 예약 배치 설정 라우트(#1247)가 실제 Medusa 위에서 `inventory_level.reserved_quantity`(와 raw_reserved_quantity)를
 * 살아 있는 예약 행의 합과 맞춰 두는지 본다 — 만들기·늘리기·줄이기·지우기·되감긴 묶음 뒤마다.
 * 쓰기는 Medusa 예약 워크플로를 지나므로 캐시가 같이 고쳐져야 한다. 직접 DB 를 쓰는 길이 끼면 여기서 어긋난다.
 * 실행: scripts/local/run-medusa-integration.sh --testPathPattern 'line-item-reservations'
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: { WALLET_BASE_URL, WALLET_API_KEY: 'test-wallet-key' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let c: Commerce;
    const ctx = { api, getContainer };
    beforeAll(async () => {
      await wallet.start();
      c = await setupCommerce(ctx);
    });
    afterAll(async () => wallet.stop());
    beforeEach(() => wallet.reset());

    const setReservations = async (items: Item[]): Promise<Result[]> => {
      const res = await api.post('/admin/line-item-reservations', { items }, c.adminHeaders);
      return res.data.results as Result[];
    };

    /** 줄의 살아 있는 예약 합과, 그 예약이 걸린 재고 레벨의 캐시 두 칸. */
    const ledgerOf = async (lineItemId: string) => {
      const knex = getContainer().resolve(ContainerRegistrationKeys.PG_CONNECTION);
      const { rows: lineRows } = await knex.raw(
        `select coalesce(sum(quantity), 0)::int as live from reservation_item where line_item_id = ? and deleted_at is null`,
        [lineItemId],
      );
      const { rows: levels } = await knex.raw(
        `select il.reserved_quantity, il.raw_reserved_quantity,
                (select coalesce(sum(r.quantity), 0)::int from reservation_item r
                  where r.inventory_item_id = il.inventory_item_id and r.location_id = il.location_id and r.deleted_at is null) as live_at_level
           from inventory_level il
           join product_variant_inventory_item pvii on pvii.inventory_item_id = il.inventory_item_id and pvii.deleted_at is null
           join order_line_item li on li.variant_id = pvii.variant_id
          where li.id = ? and il.deleted_at is null`,
        [lineItemId],
      );
      expect(levels).toHaveLength(1); // 픽스처는 위치 하나에만 재고 레벨을 둔다
      const level = levels[0];
      return {
        line: Number(lineRows[0].live),
        liveAtLevel: Number(level.live_at_level),
        reserved: Number(level.reserved_quantity),
        rawReserved: Number(level.raw_reserved_quantity?.value),
      };
    };

    /** 캐시 두 칸이 그 레벨의 살아 있는 예약 합과 같고, 줄의 합이 기대값이다. */
    const expectConsistent = async (lineItemId: string, expectedLine: number) => {
      const l = await ledgerOf(lineItemId);
      expect(l.line).toBe(expectedLine);
      expect(l.reserved).toBe(l.liveAtLevel);
      expect(l.rawReserved).toBe(l.liveAtLevel);
    };

    const lineItemsOf = async (orderId: string) => {
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({ entity: 'order', fields: ['items.id', 'items.variant_id'], filters: { id: orderId } });
      return (data[0] as { items: { id: string; variant_id: string }[] }).items;
    };

    it('지우기 → 만들기 → 늘리기 → 줄이기 → 지우기 동안 reserved_quantity 가 살아 있는 예약 합과 같다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, { lines: [{ variant: 'A', quantity: 3 }] });
      const [line] = await lineItemsOf(orderId);
      await expectConsistent(line.id, 3); // 결제 완료가 만든 예약

      // 지우기(3 → 0)
      expect(await setReservations([{ line_item_id: line.id, quantity: 0, allow_decrease: true }])).toEqual([
        expect.objectContaining({ outcome: 'set', quantity_before: 3, quantity_after: 0 }),
      ]);
      await expectConsistent(line.id, 0);

      // 만들기(0 → 2)
      expect(await setReservations([{ line_item_id: line.id, quantity: 2, allow_decrease: false }])).toEqual([
        expect.objectContaining({ outcome: 'set', quantity_before: 0, quantity_after: 2 }),
      ]);
      await expectConsistent(line.id, 2);

      // 늘리기(2 → 3)
      expect(await setReservations([{ line_item_id: line.id, quantity: 3, allow_decrease: false }])).toEqual([
        expect.objectContaining({ outcome: 'set', quantity_before: 2, quantity_after: 3 }),
      ]);
      await expectConsistent(line.id, 3);

      // 감소 금지면 줄이지 않는다(deferred)
      expect(await setReservations([{ line_item_id: line.id, quantity: 1, allow_decrease: false }])).toEqual([
        expect.objectContaining({ outcome: 'deferred', quantity_before: 3, quantity_after: 3 }),
      ]);
      await expectConsistent(line.id, 3);

      // 줄이기(3 → 1)
      expect(await setReservations([{ line_item_id: line.id, quantity: 1, allow_decrease: true }])).toEqual([
        expect.objectContaining({ outcome: 'set', quantity_before: 3, quantity_after: 1 }),
      ]);
      await expectConsistent(line.id, 1);

      // 같은 값이면 쓰지 않는다
      expect(await setReservations([{ line_item_id: line.id, quantity: 1, allow_decrease: true }])).toEqual([
        expect.objectContaining({ outcome: 'unchanged', quantity_before: 1, quantity_after: 1 }),
      ]);

      // 지우기(1 → 0)
      expect(await setReservations([{ line_item_id: line.id, quantity: 0, allow_decrease: true }])).toEqual([
        expect.objectContaining({ outcome: 'set', quantity_before: 1, quantity_after: 0 }),
      ]);
      await expectConsistent(line.id, 0);

      // 조회 라우트도 살아 있는 예약만 판매 단위로 보인다
      await setReservations([{ line_item_id: line.id, quantity: 2, allow_decrease: false }]);
      const listed = await api.get(
        `/admin/line-item-reservations?order_created_from=${encodeURIComponent('2000-01-01T00:00:00Z')}`,
        c.adminHeaders,
      );
      const mine = (listed.data.reservations as { line_item_id: string; quantity: number }[]).filter(
        (r) => r.line_item_id === line.id,
      );
      expect(mine.reduce((s, r) => s + r.quantity, 0)).toBe(2);
      await expectConsistent(line.id, 2);
    });

    it('묶음 안의 쓰기 하나가 실패하면 앞서 쓴 줄도 되감기고 reserved_quantity 는 예약 합과 그대로 같다', async () => {
      const { orderId } = await placeOrder(ctx, c, wallet, {
        lines: [
          { variant: 'B', quantity: 2 },
          { variant: 'C', quantity: 1 },
        ],
      });
      const items = await lineItemsOf(orderId);
      const lineB = items.find((i) => i.variant_id === c.variants.B)!;
      const lineC = items.find((i) => i.variant_id === c.variants.C)!;
      // B 는 예약을 지워 0 으로 두고(묶음에서 «만들기»가 되게), C 는 결제가 만든 1 그대로(묶음에서 «지우기»)
      await setReservations([{ line_item_id: lineB.id, quantity: 0, allow_decrease: true }]);
      await expectConsistent(lineB.id, 0);
      await expectConsistent(lineC.id, 1);

      // 만들기(B) 는 성공하고 그 뒤의 지우기(C) 가 던진다 → 워크플로가 B 의 만들기를 보상으로 되감아야 한다
      const inventory = getContainer().resolve(Modules.INVENTORY);
      const spy = jest
        .spyOn(inventory, 'softDeleteReservationItems')
        .mockRejectedValueOnce(new Error('injected delete failure'));
      try {
        const results = await setReservations([
          { line_item_id: lineB.id, quantity: 2, allow_decrease: false },
          { line_item_id: lineC.id, quantity: 0, allow_decrease: true },
        ]);
        expect(spy).toHaveBeenCalled();
        const byLine = new Map(results.map((r) => [r.line_item_id, r]));
        expect(byLine.get(lineB.id)).toMatchObject({
          outcome: 'error',
          quantity_before: 0,
          quantity_after: 0,
          message: expect.stringContaining('injected delete failure'),
        });
        expect(byLine.get(lineC.id)).toMatchObject({ outcome: 'error', quantity_before: 1, quantity_after: 1 });
      } finally {
        spy.mockRestore();
      }
      await expectConsistent(lineB.id, 0);
      await expectConsistent(lineC.id, 1);

      // 같은 묶음을 다시 보내면 둘 다 맞춰진다
      const retried = await setReservations([
        { line_item_id: lineB.id, quantity: 2, allow_decrease: false },
        { line_item_id: lineC.id, quantity: 0, allow_decrease: true },
      ]);
      expect(retried.map((r) => r.outcome)).toEqual(['set', 'set']);
      await expectConsistent(lineB.id, 2);
      await expectConsistent(lineC.id, 0);
    });
  },
});
