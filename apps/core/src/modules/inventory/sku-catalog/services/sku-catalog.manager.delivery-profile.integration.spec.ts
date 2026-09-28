import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedHolder } from '../../../fulfillment/services/__support__';
import { SkuCatalogReader } from './sku-catalog.reader';
import { SkuCatalogManager } from './sku-catalog.manager';
import { SkuCatalogService } from './sku-catalog.service';
import { MatchingLinkResolver } from '../../../product-matching/services/matching-link-resolver';
import { SkuDeliveryProfileNotFoundError, SkuDeliveryProfileRequiredError } from '../sku-catalog.errors';

/**
 * 새 SKU 배송 프로필 필수화 (스펙 §4). 실행:
 * COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'sku-catalog\.manager\.delivery-profile\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const MISSING_PROFILE = '99999999-9999-4999-8999-999999999999';

describeIfDb('SkuCatalogManager × 배송 프로필 필수 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function build(trx: DbTx): { manager: SkuCatalogManager; service: SkuCatalogService } {
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
    const reader = new SkuCatalogReader(dbService);
    const manager = new SkuCatalogManager(dbService, reader);
    return { manager, service: new SkuCatalogService(reader, manager) };
  }

  async function seedProfile(trx: DbTx): Promise<string> {
    const [row] = await trx
      .insert(wmsTables.deliveryProfiles)
      .values({
        name: `it-profile-${Date.now()}`,
        sourceType: 'in_house',
        senderSnapshot: { name: 'S', phone: '02-0000-0000' },
        originAddressSnapshot: { postalCode: '14521', roadAddress: 'R', detailAddress: '' },
        returnAddressSnapshot: { postalCode: '14521', roadAddress: 'R', detailAddress: '' },
        carrierAccountRef: 'it',
        supportedFulfillmentModes: ['in_house'],
      })
      .returning();
    return row.id;
  }

  async function seedLegacySku(trx: DbTx, holderId: string): Promise<string> {
    // 라이브 옛 SKU 모양: physical 인데 프로필 없음 (규칙 이전에 만들어진 행)
    const [row] = await trx
      .insert(wmsTables.skus)
      .values({ name: 'legacy', code: `IT-LEGACY-${Date.now()}`, holderId, stockType: 'physical' })
      .returning();
    return row.id;
  }

  it('physical SKU 를 프로필 없이 만들면 SKU_DELIVERY_PROFILE_REQUIRED', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      await expect(build(trx).manager.create({ name: 'p', holderId }, trx)).rejects.toBeInstanceOf(
        SkuDeliveryProfileRequiredError,
      );
    });
  });

  it('프로필을 주면 만들어진다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const profileId = await seedProfile(trx);
      const sku = await build(trx).manager.create({ name: 'p', holderId, deliveryProfileId: profileId }, trx);
      expect(sku.deliveryProfileId).toBe(profileId);
    });
  });

  it('drop_shipped 는 프로필 없이 만들어진다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const sku = await build(trx).manager.create({ name: 'd', holderId, stockType: 'drop_shipped' }, trx);
      expect(sku.deliveryProfileId ?? null).toBeNull();
    });
  });

  it('없는 프로필 id 는 400 SKU_DELIVERY_PROFILE_NOT_FOUND (FK 500 이 아니라)', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      await expect(
        build(trx).manager.create({ name: 'p', holderId, deliveryProfileId: MISSING_PROFILE }, trx),
      ).rejects.toBeInstanceOf(SkuDeliveryProfileNotFoundError);
    });
  });

  it('이름만 바꾸면 옛 SKU 도 통과 (stockType 을 같은 값으로 함께 보내도)', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const skuId = await seedLegacySku(trx, holderId);
      const sku = await build(trx).manager.update(skuId, { name: 'renamed', stockType: 'physical' }, trx);
      expect(sku.name).toBe('renamed');
    });
  });

  it('프로필을 null 로 지우면 거부', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const profileId = await seedProfile(trx);
      const { manager } = build(trx);
      const sku = await manager.create({ name: 'p', holderId, deliveryProfileId: profileId }, trx);
      // UpdateSkuDto 타입은 string 뿐이지만 HTTP 로는 null(지움)이 들어온다 — 그 런타임 입력을 재현하는 캐스트
      await expect(
        manager.update(sku.id, { deliveryProfileId: null as unknown as string }, trx),
      ).rejects.toBeInstanceOf(SkuDeliveryProfileRequiredError);
    });
  });

  it('drop_shipped → physical 전환은 프로필이 있어야 한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const profileId = await seedProfile(trx);
      const { manager } = build(trx);
      const sku = await manager.create({ name: 'd', holderId, stockType: 'drop_shipped' }, trx);
      await expect(manager.update(sku.id, { stockType: 'physical' }, trx)).rejects.toBeInstanceOf(
        SkuDeliveryProfileRequiredError,
      );
      const ok = await manager.update(sku.id, { stockType: 'physical', deliveryProfileId: profileId }, trx);
      expect(ok.deliveryProfileId).toBe(profileId);
    });
  });

  it('옛 SKU 에 프로필을 붙이는 건 통과 (건별 백필 경로)', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const skuId = await seedLegacySku(trx, holderId);
      const profileId = await seedProfile(trx);
      const sku = await build(trx).manager.update(skuId, { deliveryProfileId: profileId }, trx);
      expect(sku.deliveryProfileId).toBe(profileId);
    });
  });

  it('매칭의 새 SKU 경로도 같은 규칙을 탄다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { holderId } = await seedHolder(trx);
      const resolver = new MatchingLinkResolver(build(trx).service);
      await expect(resolver.resolve([{ newSku: { name: 'm', holderId } }], trx)).rejects.toBeInstanceOf(
        SkuDeliveryProfileRequiredError,
      );
    });
  });
});
