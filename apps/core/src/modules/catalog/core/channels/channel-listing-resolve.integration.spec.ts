// jest moduleNameMapper 가 bare `@packages/event-contracts` 를 못 잡아 module-not-found 로 죽는다.
jest.mock(
  '@packages/event-contracts',
  () => jest.requireActual<typeof import('@packages/event-contracts')>('@packages/event-contracts/index'),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { DbTransaction } from '../../catalog.types';
import {
  catalogSchema,
  channelVariantListings,
  productMasterVariants,
  productMasterVersions,
  productMasters,
  productVariants,
  salesChannels,
  type PimSchema,
} from '../../schema/catalog.schema';
import { ChannelListingService } from './channel-listing.service';

/**
 * 진단이 **정말 그 사유를 내는지**는 실 DB 로만 확인된다 (#674). 계약 스펙은 쿼리 모양만 본다.
 *
 * 실행: `npm run test:core:integration:local -- channel-listing-resolve`
 * 격리: 각 테스트가 트랜잭션을 열어 픽스처를 넣고 항상 롤백한다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('리스팅 해석 실패 사유 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: DbService<PimSchema>;
  let service: ChannelListingService;

  beforeAll(() => {
    const connection = postgres(DATABASE_URL as string, { max: 1 });
    sql = connection;
    const drizzleDb = drizzle(connection, { schema: catalogSchema });
    db = {
      db: drizzleDb,
      run: <T>(fn: (t: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> =>
        tx ? fn(tx) : drizzleDb.transaction((t) => fn(t)),
    } as unknown as DbService<PimSchema>;
    service = new ChannelListingService(db, {} as never);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 0 });
  });

  async function inRollbackTx<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    let captured!: T;
    await expect(
      db.run(async (tx) => {
        captured = await fn(tx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
    return captured;
  }

  /** 마스터 1 + 버전 1 + 품목 1 + 리스팅 1. opts 로 한 축씩 망가뜨린다. */
  async function seed(
    tx: DbTransaction,
    opts: {
      versionStatus?: 'active' | 'inactive' | 'draft';
      versionDeleted?: boolean;
      masterDeleted?: boolean;
      listingActive?: boolean;
      channelActive?: boolean;
      variantStatus?: 'active' | 'inactive';
      linkVersion?: boolean;
    } = {},
  ) {
    const masterId = randomUUID();
    const variantId = randomUUID();
    const channelItemId = `item-${masterId.slice(0, 8)}`;

    await tx.insert(productMasters).values({
      id: masterId,
      createdBy: null,
      ...(opts.masterDeleted ? { deletedAt: new Date() } : {}),
    });
    const [version] = await tx
      .insert(productMasterVersions)
      .values({
        masterId,
        name: `해석-${masterId.slice(0, 8)}`,
        status: opts.versionStatus ?? 'active',
        ...(opts.versionDeleted ? { deletedAt: new Date() } : {}),
      })
      .returning({ id: productMasterVersions.id });

    await tx.insert(productVariants).values({ id: variantId, isDefault: true, status: opts.variantStatus ?? 'active' });

    if (opts.linkVersion !== false) {
      await tx.insert(productMasterVariants).values({ masterId, variantId, versionId: version.id });
    }

    const site = `spec-${masterId.slice(0, 8)}`;
    const [channel] = await tx
      .insert(salesChannels)
      .values({ site, name: '스펙 채널', isActive: opts.channelActive ?? true })
      .returning({ id: salesChannels.id });

    await tx.insert(channelVariantListings).values({
      variantId,
      salesChannelId: channel.id,
      channelItemId,
      isActive: opts.listingActive ?? true,
    });

    return { site, channelItemId, variantId };
  }

  it('정상이면 found: true 와 매핑을 준다', async () => {
    const out = await inRollbackTx(async (tx) => {
      const { site, channelItemId, variantId } = await seed(tx);
      return { result: await service.resolveVariantByChannelCode(site, channelItemId, tx), variantId };
    });
    expect(out.result.found).toBe(true);
    if (out.result.found) expect(out.result.listing.variantId).toBe(out.variantId);
  });

  it('매핑이 없으면 listing_not_found', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site } = await seed(tx);
      return service.resolveVariantByChannelCode(site, 'item-does-not-exist', tx);
    });
    expect(result).toEqual({ found: false, cause: 'listing_not_found' });
  });

  it('꺼진 리스팅은 listing_inactive', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { listingActive: false });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'listing_inactive' });
  });

  it('꺼진 채널은 channel_inactive', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { channelActive: false });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'channel_inactive' });
  });

  it('판매중지 품목은 variant_inactive', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { variantStatus: 'inactive' });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'variant_inactive' });
  });

  it('draft 버전만 있으면 no_active_version', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { versionStatus: 'draft' });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'no_active_version' });
  });

  it('어떤 버전에도 안 매달린 품목은 no_active_version', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { linkVersion: false });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'no_active_version' });
  });

  it('soft delete 된 마스터는 product_deleted', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { masterDeleted: true });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'product_deleted' });
  });

  it('soft delete 된 버전도 product_deleted', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { versionDeleted: true });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'product_deleted' });
  });

  it('삭제와 판매중지가 겹치면 product_deleted 가 이긴다', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { masterDeleted: true, variantStatus: 'inactive' });
      return service.resolveVariantByChannelCode(site, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'product_deleted' });
  });

  it('판매채널 ID 진입점도 같은 사유를 낸다', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { site, channelItemId } = await seed(tx, { variantStatus: 'inactive' });
      const [channel] = await tx
        .select({ id: salesChannels.id })
        .from(salesChannels)
        .where(eq(salesChannels.site, site))
        .limit(1);
      return service.resolveVariant(channel.id, channelItemId, tx);
    });
    expect(result).toEqual({ found: false, cause: 'variant_inactive' });
  });
});
