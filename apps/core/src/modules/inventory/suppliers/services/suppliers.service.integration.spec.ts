import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { ConflictError } from '@app/shared';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedWarehouseWithZone } from '../../../fulfillment/services/__support__';
import { SuppliersService } from './suppliers.service';
import {
  SupplierHasDropShippedSkusError,
  SupplierHasShipmentsError,
  SupplierWouldDoubleDirectError,
} from '../suppliers.errors';

/**
 * 공급사 하드 삭제 × 보충 규칙(#743 B). `replenishment_supplier_rules.supplier_id` 의 FK 는
 * **restrict** 라(스펙 §8.1), 세지 않고 지우면 postgres 23503 이 `ApplicationException` 을 거치지
 * 않고 그대로 500 이 된다. 스펙 §9.2 1단계가 활성 공급사 전부에 규칙을 채우라고 하므로 그 500 은
 * 예외가 아니라 평상시가 된다 — 409 로 바뀐 것을 여기서 고정한다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'suppliers/services/suppliers\.service\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('SuppliersService.deleteSupplier × 보충 공급사 규칙 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function build(trx: DbTx): SuppliersService {
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
    return new SuppliersService(dbService);
  }

  async function seedSupplier(trx: DbTx): Promise<string> {
    const { warehouseId } = await seedWarehouseWithZone(trx);
    const [supplier] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-sup-${randomUUID().slice(0, 8)}`, defaultWarehouseId: warehouseId })
      .returning({ id: wmsTables.suppliers.id });
    return supplier.id;
  }

  it('보충 규칙 행이 있으면 409 — 무엇을 먼저 지워야 하는지 메시지가 알린다', async () => {
    await inRollbackTx(db, async (trx) => {
      const supplierId = await seedSupplier(trx);
      await trx
        .insert(wmsTables.replenishmentSupplierRules)
        .values({ supplierId, leadTimeDays: 25, leadTimeStdDays: null, coverDays: 40 });

      const service = build(trx);
      const error = await service.deleteSupplier(supplierId, trx).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({ message: expect.stringContaining('재고 보충 규칙 화면') });

      // 판정이 막았으므로 공급사는 그대로 남아 있어야 한다 — 부분 삭제가 아니다.
      const rows = await trx
        .select({ id: wmsTables.suppliers.id })
        .from(wmsTables.suppliers)
        .where(eq(wmsTables.suppliers.id, supplierId));
      expect(rows).toHaveLength(1);
    });
  });

  it('규칙 행이 없으면 그대로 삭제된다', async () => {
    await inRollbackTx(db, async (trx) => {
      const supplierId = await seedSupplier(trx);
      const service = build(trx);

      await expect(service.deleteSupplier(supplierId, trx)).resolves.toBeUndefined();

      const rows = await trx
        .select({ id: wmsTables.suppliers.id })
        .from(wmsTables.suppliers)
        .where(eq(wmsTables.suppliers.id, supplierId));
      expect(rows).toHaveLength(0);
    });
  });

  it('규칙을 먼저 지우면 같은 공급사가 삭제된다 — 409 는 영구 차단이 아니다', async () => {
    await inRollbackTx(db, async (trx) => {
      const supplierId = await seedSupplier(trx);
      const t = wmsTables.replenishmentSupplierRules;
      await trx.insert(t).values({ supplierId, leadTimeDays: 25, leadTimeStdDays: null, coverDays: 40 });

      const service = build(trx);
      await expect(service.deleteSupplier(supplierId, trx)).rejects.toBeInstanceOf(ConflictError);

      await trx.delete(t).where(eq(t.supplierId, supplierId));
      await expect(service.deleteSupplier(supplierId, trx)).resolves.toBeUndefined();
    });
  });

  describe('직배 공급사(K3 §4.2, N6)', () => {
    async function seedDirect(trx: DbTx): Promise<string> {
      const [row] = await trx
        .insert(wmsTables.suppliers)
        .values({ name: `it-direct-${randomUUID().slice(0, 8)}`, isDirectDelivery: true })
        .returning({ id: wmsTables.suppliers.id });
      return row.id;
    }

    async function linkSku(
      trx: DbTx,
      supplierId: string,
      args: { stockType: 'drop_shipped' | 'physical'; isDeleted?: boolean },
    ): Promise<string> {
      const [holder] = await trx
        .insert(wmsTables.holders)
        .values({ name: `it-h-${randomUUID().slice(0, 8)}` })
        .returning();
      const [sku] = await trx
        .insert(wmsTables.skus)
        .values({
          name: 'it',
          code: `IT-DS-${randomUUID()}`,
          holderId: holder.id,
          stockType: args.stockType,
          isDeleted: args.isDeleted ?? false,
        })
        .returning();
      await trx.insert(wmsTables.skuSuppliers).values({ skuId: sku.id, supplierId });
      return sku.id;
    }

    it('직배 SKU 가 묶인 공급사를 직배 아님으로 바꾸면 409 SUPPLIER_HAS_DROP_SHIPPED_SKUS', async () => {
      await inRollbackTx(db, async (trx) => {
        const supplierId = await seedDirect(trx);
        await linkSku(trx, supplierId, { stockType: 'drop_shipped' });
        const error = await build(trx)
          .updateSupplier(supplierId, { isDirectDelivery: false }, trx)
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SupplierHasDropShippedSkusError);
        expect((error as SupplierHasDropShippedSkusError).getHttpStatus()).toBe(409);
      });
    });

    it('묶인 SKU 가 physical 이면 직배 아님으로 바꿀 수 있다', async () => {
      await inRollbackTx(db, async (trx) => {
        const supplierId = await seedDirect(trx);
        await linkSku(trx, supplierId, { stockType: 'physical' });
        const updated = await build(trx).updateSupplier(supplierId, { isDirectDelivery: false }, trx);
        expect(updated.purchaseSettings?.isDirectDelivery ?? false).toBe(false);
      });
    });

    it('직배 SKU 가 묶인 공급사 삭제는 409, 연결은 그대로 남는다', async () => {
      await inRollbackTx(db, async (trx) => {
        const supplierId = await seedDirect(trx);
        const skuId = await linkSku(trx, supplierId, { stockType: 'drop_shipped' });
        await expect(build(trx).deleteSupplier(supplierId, trx)).rejects.toBeInstanceOf(
          SupplierHasDropShippedSkusError,
        );
        const links = await trx.select().from(wmsTables.skuSuppliers).where(eq(wmsTables.skuSuppliers.skuId, skuId));
        expect(links).toHaveLength(1);
      });
    });

    it('지운 SKU(is_deleted)의 연결은 세지 않는다', async () => {
      await inRollbackTx(db, async (trx) => {
        const supplierId = await seedDirect(trx);
        await linkSku(trx, supplierId, { stockType: 'drop_shipped', isDeleted: true });
        await expect(build(trx).updateSupplier(supplierId, { isDirectDelivery: false }, trx)).resolves.toBeDefined();
      });
    });

    async function seedPlain(trx: DbTx): Promise<string> {
      const [row] = await trx
        .insert(wmsTables.suppliers)
        .values({ name: `it-plain-${randomUUID().slice(0, 8)}`, isDirectDelivery: false })
        .returning({ id: wmsTables.suppliers.id });
      return row.id;
    }

    it('직배 SKU 에 이미 다른 직배 공급사가 있으면 직배로 바꾸지 못한다 — 409 SUPPLIER_WOULD_DOUBLE_DIRECT', async () => {
      await inRollbackTx(db, async (trx) => {
        const direct = await seedDirect(trx);
        const plain = await seedPlain(trx);
        const skuId = await linkSku(trx, direct, { stockType: 'drop_shipped' });
        await trx.insert(wmsTables.skuSuppliers).values({ skuId, supplierId: plain });
        const error = await build(trx)
          .updateSupplier(plain, { isDirectDelivery: true }, trx)
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SupplierWouldDoubleDirectError);
        expect((error as SupplierWouldDoubleDirectError).getHttpStatus()).toBe(409);
      });
    });

    it('직배 SKU 에 직배 공급사가 없으면 그 공급사를 직배로 바꿀 수 있다', async () => {
      await inRollbackTx(db, async (trx) => {
        const plain = await seedPlain(trx);
        await linkSku(trx, plain, { stockType: 'drop_shipped' });
        await expect(build(trx).updateSupplier(plain, { isDirectDelivery: true }, trx)).resolves.toBeDefined();
      });
    });

    it('직배가 아닌 공급사는 직배 SKU 가 묶여 있어도 삭제된다 — 규칙은 직배 연결만 센다', async () => {
      await inRollbackTx(db, async (trx) => {
        const direct = await seedDirect(trx);
        const plain = await seedPlain(trx);
        const skuId = await linkSku(trx, direct, { stockType: 'drop_shipped' });
        await trx.insert(wmsTables.skuSuppliers).values({ skuId, supplierId: plain });
        await expect(build(trx).deleteSupplier(plain, trx)).resolves.toBeUndefined();
      });
    });

    it('입점사 상자가 있는 공급사 삭제는 409 SUPPLIER_HAS_SHIPMENTS', async () => {
      await inRollbackTx(db, async (trx) => {
        const supplierId = await seedDirect(trx);
        await trx.insert(wmsTables.shipments).values({ supplierId });
        await expect(build(trx).deleteSupplier(supplierId, trx)).rejects.toBeInstanceOf(SupplierHasShipmentsError);
      });
    });
  });
});
