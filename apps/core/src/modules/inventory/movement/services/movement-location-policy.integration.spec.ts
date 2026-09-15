import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { wmsTables } from '../../schema/inventory.schema';
import { lockWorkLocations } from '../../shared/locks/location-work-lock';
import { makeDb, inRollbackTx, seedWarehouseWithZone } from '../../../fulfillment/services/__support__';
import {
  DATABASE_URL,
  describeIfDb,
  wiringFor,
  seed,
  snapshot,
  request,
} from './__support__/movement-location-policy-fixtures';

describeIfDb('movement location policy (PostgreSQL)', () => {
  let database: ReturnType<typeof makeDb>;
  beforeAll(() => {
    database = makeDb(DATABASE_URL!);
  });
  afterAll(async () => {
    await database.sql.end();
  });

  it('returns no locations for empty/missing IDs and deduplicates existing rows', async () => {
    await inRollbackTx(database.db, async (tx) => {
      const f = await seedWarehouseWithZone(tx);
      expect(await lockWorkLocations(tx, [])).toEqual(new Map());
      expect(await lockWorkLocations(tx, [randomUUID()])).toEqual(new Map());
      const locked = await lockWorkLocations(tx, [f.locationId, f.locationId]);
      expect(locked.size).toBe(1);
      expect(locked.get(f.locationId)).toMatchObject({ warehouseId: f.warehouseId });
    });
  });

  it('rejects an inactive destination with 409 without changing ledger, events, jobs or work logs', async () => {
    await inRollbackTx(database.db, async (tx) => {
      const f = await seed(tx);
      const before = await snapshot(tx, f);
      // The savepoint models the service-owned transaction rollback inside the ambient fixture.
      await expect(
        tx.transaction((savepoint) => wiringFor(savepoint).movement.moveImmediately(request(f))),
      ).rejects.toMatchObject({ status: 409, response: { code: 'MOVEMENT_DESTINATION_INACTIVE' } });
      expect(await snapshot(tx, f)).toEqual(before);
    });
  });
  it.each([undefined, 2] as const)(
    'allows inactive-source recovery and success replay after deactivation (version %s)',
    async (contractVersion) => {
      await inRollbackTx(database.db, async (tx) => {
        const f = await seed(tx);
        await tx.update(wmsTables.locations).set({ isActive: false }).where(eq(wmsTables.locations.id, f.locationId));
        await tx.update(wmsTables.locations).set({ isActive: true }).where(eq(wmsTables.locations.id, f.dest.id));
        const dto = { ...request(f, 2), contractVersion };
        const actorId = randomUUID();
        const result = await f.wiring.movement.moveImmediately(dto, actorId);
        const state = await snapshot(tx, f);
        expect(state.ledgers.find((row) => row.locationId === f.locationId)?.qty).toBe(3);
        expect(state.ledgers.find((row) => row.locationId === f.dest.id)?.qty).toBe(2);
        await tx.update(wmsTables.locations).set({ isActive: false }).where(eq(wmsTables.locations.id, f.dest.id));
        expect(await f.wiring.movement.moveImmediately(dto, actorId)).toEqual(JSON.parse(JSON.stringify(result)));
        expect(await snapshot(tx, f)).toEqual(state);
      });
    },
  );

  it('rolls back the whole multi-line move when one destination is inactive', async () => {
    await inRollbackTx(database.db, async (tx) => {
      const f = await seed(tx);
      const [active] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: f.warehouseId, code: randomUUID(), locationType: 'zone' })
        .returning();
      const dto = request(f, 2);
      dto.lines.unshift({ ...dto.lines[0], toLocationId: active.id });
      const before = await snapshot(tx, f);
      await expect(tx.transaction((sp) => wiringFor(sp).movement.moveImmediately(dto))).rejects.toMatchObject({
        response: { code: 'MOVEMENT_DESTINATION_INACTIVE' },
      });
      expect(await snapshot(tx, f)).toEqual(before);
    });
  });

  it.each(['same', 'missing', 'warehouse'] as const)(
    'preserves the existing %s destination error and makes no writes',
    async (kind) => {
      await inRollbackTx(database.db, async (tx) => {
        const f = await seed(tx);
        const other = await seedWarehouseWithZone(tx);
        const dto = request(f);
        dto.lines[0].toLocationId =
          kind === 'same' ? f.locationId : kind === 'missing' ? randomUUID() : other.locationId;
        const messages = {
          same: 'from/to locations must be different',
          missing: 'invalid location id in lines',
          warehouse: 'all locations must belong to provided warehouseId',
        };
        const before = await snapshot(tx, f);
        await expect(tx.transaction((sp) => wiringFor(sp).movement.moveImmediately(dto))).rejects.toMatchObject({
          status: 400,
          message: messages[kind],
        });
        expect(await snapshot(tx, f)).toEqual(before);
      });
    },
  );

  it('allows free stock into and out of system locations while protecting inbound pending stock', async () => {
    await inRollbackTx(database.db, async (tx) => {
      const f = await seed(tx);
      await f.wiring.location.ensureSystemLocations(f.warehouseId, tx);
      const system = await f.wiring.location.getSystemLocationByRole(f.warehouseId, 'inbound_default', tx);
      const dto = request(f, 2);
      dto.lines[0].toLocationId = system.id;
      await f.wiring.movement.moveImmediately(dto);
      await f.wiring.movement.moveImmediately({
        ...dto,
        idempotencyKey: randomUUID(),
        lines: [{ ...dto.lines[0], fromLocationId: system.id, toLocationId: f.locationId }],
      });
      await f.wiring.kernel.recordArrival(
        {
          source: 'direct',
          method: 'simple',
          warehouseId: f.warehouseId,
          reason: 'pending',
          lines: [{ skuId: f.skuId, quantity: 3, eventKey: randomUUID() }],
        },
        tx,
      );
      const before = await snapshot(tx, f);
      await expect(
        tx.transaction((sp) =>
          wiringFor(sp).movement.moveImmediately({
            ...dto,
            idempotencyKey: randomUUID(),
            lines: [{ ...dto.lines[0], fromLocationId: system.id, toLocationId: f.locationId }],
          }),
        ),
      ).rejects.toMatchObject({ response: { code: 'INBOUND_ORIGIN_STOCK_PROTECTED' } });
      expect(await snapshot(tx, f)).toEqual(before);
    });
  });

  it('system bootstrap reactivates legacy rows and remains idempotent after the lock-order change', async () => {
    await inRollbackTx(database.db, async (tx) => {
      const f = await seed(tx);
      await f.wiring.location.ensureSystemLocations(f.warehouseId, tx);
      const before = await tx
        .select()
        .from(wmsTables.locations)
        .where(eq(wmsTables.locations.warehouseId, f.warehouseId));
      const system = before.filter((location) => location.isSystem);
      expect(system).toHaveLength(4);
      for (const location of system) {
        await tx.update(wmsTables.locations).set({ isActive: false }).where(eq(wmsTables.locations.id, location.id));
      }
      await f.wiring.location.ensureSystemLocations(f.warehouseId, tx);
      await f.wiring.location.ensureSystemLocations(f.warehouseId, tx);
      const after = await tx
        .select()
        .from(wmsTables.locations)
        .where(eq(wmsTables.locations.warehouseId, f.warehouseId));
      expect(
        after
          .filter((location) => location.isSystem)
          .map((location) => location.id)
          .sort(),
      ).toEqual(system.map((location) => location.id).sort());
      expect(after.filter((location) => location.isSystem).every((location) => location.isActive)).toBe(true);
    });
  });

  it.each(['system', 'inactive', 'same', 'missing', 'warehouse'] as const)(
    'preserves putaway %s destination errors before quantity errors',
    async (kind) => {
      await inRollbackTx(database.db, async (tx) => {
        const f = await seed(tx);
        const arrival = await f.wiring.kernel.recordArrival(
          {
            source: 'direct',
            method: 'simple',
            warehouseId: f.warehouseId,
            reason: 'pending',
            lines: [{ skuId: f.skuId, quantity: 3, eventKey: randomUUID() }],
          },
          tx,
        );
        const system = await f.wiring.location.getSystemLocationByRole(f.warehouseId, 'return_default', tx);
        const other = await seedWarehouseWithZone(tx);
        const toLocationId = {
          system: system.id,
          inactive: f.dest.id,
          same: arrival.receipt.locationId!,
          missing: randomUUID(),
          warehouse: other.locationId,
        }[kind];
        const expected = {
          system: { status: 409, response: { code: 'INBOUND_PUTAWAY_DESTINATION_INVALID' } },
          same: { status: 409, response: { code: 'INBOUND_PUTAWAY_DESTINATION_INVALID' } },
          inactive: { status: 400, message: 'destination location is inactive' },
          missing: { status: 404, message: 'destination location not found' },
          warehouse: { status: 400, message: 'destination location must be in the same warehouse' },
        };
        const before = await snapshot(tx, f);
        await expect(
          tx.transaction((sp) =>
            wiringFor(sp).kernel.putaway(
              { receiptLineId: arrival.lines[0].id, toLocationId, quantity: 0, eventKey: randomUUID() },
              sp,
            ),
          ),
        ).rejects.toMatchObject(expected[kind]);
        expect(await snapshot(tx, f)).toEqual(before);
        const [line] = await tx
          .select()
          .from(wmsTables.inboundReceiptLines)
          .where(eq(wmsTables.inboundReceiptLines.id, arrival.lines[0].id));
        expect(line.putawayFromOriginQty).toBe(0);
      });
    },
  );
});
