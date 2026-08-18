// jest moduleNameMapper 가 bare `@packages/event-contracts` 를 못 잡아 module-not-found 로 죽는다.
// 매핑되는 서브패스로 requireActual 하는 것이 이 레포의 상시 우회다.
jest.mock(
  '@packages/event-contracts',
  () => jest.requireActual<typeof import('@packages/event-contracts')>('@packages/event-contracts/index'),
  { virtual: true },
);

import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { DbService } from '@app/db';
import { DbTransaction } from '../../catalog.types';
import {
  catalogSchema,
  type PimSchema,
  channelVariantListings,
  productMasters,
  productMasterVariants,
  productMasterVersions,
  productVariants,
  salesChannels,
} from '../../schema/catalog.schema';
import { ChannelListingService } from './channel-listing.service';

/**
 * 채널 리스팅 조회가 **활성 버전에만** 매핑을 내주는지 확인한다 (#666).
 *
 * 검증 대상이 SQL 술어 자체라 DB 를 목으로 두면 아무것도 확인하지 못한다 — 큐 mock 은
 * where 절과 무관하게 넣어둔 행을 돌려주기 때문이다. 조회가 낡은 버전을 내주면 채널 주문이
 * 옛 판매정책·옛 SKU 스냅샷으로 조용히 처리된다(#652); null 이 나가야 미식별 격리로 간다.
 *
 * 실행: `npm run test:core:integration:local -- channel-listing-lookup`
 * 격리: 각 테스트가 트랜잭션을 열어 픽스처를 넣고 항상 롤백한다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('채널 리스팅 조회는 활성 버전만 내준다 (실 Postgres)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: DbService<PimSchema>;
  let service: ChannelListingService;

  beforeAll(() => {
    // Nest DI 를 띄우지 않는다 — product-masters-selection.integration.spec.ts 와 같은 이유·같은 형태.
    const connection = postgres(DATABASE_URL as string, { max: 1 });
    sql = connection;
    const drizzleDb = drizzle(connection, { schema: catalogSchema });

    db = {
      db: drizzleDb,
      run: <T>(fn: (t: DbTransaction) => Promise<T>, tx?: DbTransaction): Promise<T> =>
        tx ? fn(tx) : drizzleDb.transaction((t) => fn(t)),
    } as unknown as DbService<PimSchema>;

    // lookupVariant 는 가용재고 협력자를 건드리지 않는다 (쓰기 경로에서만 쓰인다).
    service = new ChannelListingService(db, {} as never);
  });

  afterAll(async () => {
    await sql?.end();
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

  /** 마스터 1건 + 버전 1건 + 품목 1건 + 그 품목을 가리키는 채널 리스팅 1건. */
  async function seedListing(
    tx: DbTransaction,
    opts: {
      status?: 'active' | 'inactive' | 'draft';
      versionDeleted?: boolean;
      masterDeleted?: boolean;
      listingActive?: boolean;
      variantStatus?: 'active' | 'inactive';
      channelActive?: boolean;
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
        name: `조회-${masterId.slice(0, 8)}`,
        status: opts.status ?? 'active',
        ...(opts.versionDeleted ? { deletedAt: new Date() } : {}),
      })
      .returning({ id: productMasterVersions.id });

    await tx.insert(productVariants).values({ id: variantId, isDefault: true, status: opts.variantStatus ?? 'active' });
    await tx.insert(productMasterVariants).values({ masterId, variantId, versionId: version.id });

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

    return { salesChannelId: channel.id, site, channelItemId, variantId };
  }

  it('활성 버전에 매달린 품목은 그대로 조회된다', async () => {
    const found = await inRollbackTx(async (tx) => {
      const { salesChannelId, channelItemId, variantId } = await seedListing(tx);
      const result = await service.lookupVariant(salesChannelId, channelItemId, tx);
      return { result, variantId };
    });
    expect(found.result?.variantId).toBe(found.variantId);
  });

  it('비활성 버전에만 매달린 품목은 조회되지 않는다', async () => {
    // 이게 #652 의 증상이다 — 조회가 성공해 옛 버전 값이 주문 처리에 그대로 실렸다.
    const result = await inRollbackTx(async (tx) => {
      const { salesChannelId, channelItemId } = await seedListing(tx, { status: 'inactive' });
      return service.lookupVariant(salesChannelId, channelItemId, tx);
    });
    expect(result).toBeNull();
  });

  it('draft 버전에만 매달린 품목은 조회되지 않는다', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { salesChannelId, channelItemId } = await seedListing(tx, { status: 'draft' });
      return service.lookupVariant(salesChannelId, channelItemId, tx);
    });
    expect(result).toBeNull();
  });

  it('soft delete 된 버전의 품목은 조회되지 않는다', async () => {
    // 삭제는 status 를 그대로 두고 deletedAt 만 세운다 — 상태만 보면 통과한다.
    const result = await inRollbackTx(async (tx) => {
      const { salesChannelId, channelItemId } = await seedListing(tx, { versionDeleted: true });
      return service.lookupVariant(salesChannelId, channelItemId, tx);
    });
    expect(result).toBeNull();
  });

  it('soft delete 된 마스터의 품목은 조회되지 않는다', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { salesChannelId, channelItemId } = await seedListing(tx, { masterDeleted: true });
      return service.lookupVariant(salesChannelId, channelItemId, tx);
    });
    expect(result).toBeNull();
  });

  it('판매중지된 품목은 활성 버전이어도 조회되지 않는다', async () => {
    // "블랙 L 사이즈만 판매중지" 는 실재하는 운영 동작이고, 가용재고는 이미 이 값을 판매
    // 게이트로 쓴다. 조회만 안 봐서 가용 0 인데 주문은 수집되는 틈이 있었다 (#670).
    const result = await inRollbackTx(async (tx) => {
      const { salesChannelId, channelItemId } = await seedListing(tx, { variantStatus: 'inactive' });
      return service.lookupVariant(salesChannelId, channelItemId, tx);
    });
    expect(result).toBeNull();
  });

  it('비활성 판매채널의 매핑은 조회되지 않는다', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { salesChannelId, channelItemId } = await seedListing(tx, { channelActive: false });
      return service.lookupVariant(salesChannelId, channelItemId, tx);
    });
    expect(result).toBeNull();
  });

  it('꺼진 리스팅은 활성 버전이어도 조회되지 않는다', async () => {
    const result = await inRollbackTx(async (tx) => {
      const { salesChannelId, channelItemId } = await seedListing(tx, { listingActive: false });
      return service.lookupVariant(salesChannelId, channelItemId, tx);
    });
    expect(result).toBeNull();
  });

  // 주문 수집이 실제로 타는 진입점은 이쪽이다
  // (ChannelLineIdentityResolver → lookupByChannelCode → 컨트롤러 → lookupVariantByChannelCode).
  // 두 진입점이 같은 빌더를 쓰지만, 채널 선택 술어와 salesChannels 조인은 여기만의 것이다.
  describe('채널 코드(site) 진입점 — 주문 수집 실사용 경로', () => {
    it('활성 버전에 매달린 품목은 그대로 조회된다', async () => {
      const found = await inRollbackTx(async (tx) => {
        const { site, channelItemId, variantId } = await seedListing(tx);
        const result = await service.lookupVariantByChannelCode(site, channelItemId, tx);
        return { result, variantId };
      });
      expect(found.result?.variantId).toBe(found.variantId);
    });

    it('비활성 버전에만 매달린 품목은 조회되지 않는다', async () => {
      const result = await inRollbackTx(async (tx) => {
        const { site, channelItemId } = await seedListing(tx, { status: 'inactive' });
        return service.lookupVariantByChannelCode(site, channelItemId, tx);
      });
      expect(result).toBeNull();
    });

    it('soft delete 된 마스터의 품목은 조회되지 않는다', async () => {
      const result = await inRollbackTx(async (tx) => {
        const { site, channelItemId } = await seedListing(tx, { masterDeleted: true });
        return service.lookupVariantByChannelCode(site, channelItemId, tx);
      });
      expect(result).toBeNull();
    });

    it('판매중지된 품목은 조회되지 않는다', async () => {
      const result = await inRollbackTx(async (tx) => {
        const { site, channelItemId } = await seedListing(tx, { variantStatus: 'inactive' });
        return service.lookupVariantByChannelCode(site, channelItemId, tx);
      });
      expect(result).toBeNull();
    });

    it('비활성 판매채널의 매핑은 조회되지 않는다', async () => {
      const result = await inRollbackTx(async (tx) => {
        const { site, channelItemId } = await seedListing(tx, { channelActive: false });
        return service.lookupVariantByChannelCode(site, channelItemId, tx);
      });
      expect(result).toBeNull();
    });
  });
});
