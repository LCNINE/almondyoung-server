import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { catalogSchema, salesChannels } from '../../schema/catalog.schema';
import { DbClient } from '../../catalog.types';
import {
  ChannelListingDiagnosisRow,
  buildChannelListingDiagnosisQuery,
  causeFromDiagnosisRow,
} from './channel-listing-diagnosis.query';

/**
 * 진단은 조회(`channel-listing-lookup.query.ts`)가 0행을 냈을 때만 돈다 (#674).
 *
 * 여기서는 DB 없이 두 가지를 지킨다.
 * 1. 진단 쿼리가 **sellable 술어를 걸지 않는다** — 걸면 진단도 0행이 되어 전부
 *    `listing_not_found` 로 오진한다.
 * 2. 진단 쿼리가 **LEFT JOIN 이다** — inner join 이면 `product_master_variants` 행이 없는
 *    리스팅이 0행을 내 역시 `listing_not_found` 로 오진한다.
 *
 * 우선순위는 순수 함수라 DB 가 필요 없다. 의미(정말 그 사유가 나오는가)는
 * `channel-listing-resolve.integration.spec.ts` 가 실 Postgres 로 본다.
 */
describe('채널 리스팅 진단 쿼리 (#674)', () => {
  const connection = postgres('postgres://spec:spec@127.0.0.1:1/none', { max: 1 });
  const client = drizzle(connection, { schema: catalogSchema }) as unknown as DbClient;

  afterAll(async () => {
    await connection.end({ timeout: 0 });
  });

  const sqlOf = () =>
    buildChannelListingDiagnosisQuery(client, 'item-1', eq(salesChannels.site, 'naver')).toSQL().sql;

  describe('쿼리 모양', () => {
    it('상태 술어를 하나도 걸지 않는다', () => {
      const sql = sqlOf();
      expect(sql).not.toContain('"product_variants"."status" = ');
      expect(sql).not.toContain('"product_master_versions"."status" = ');
      expect(sql).not.toContain('"sales_channels"."is_active" = ');
      expect(sql).not.toContain('"channel_variant_listings"."is_active" = ');
      expect(sql).not.toContain('deleted_at" is null');
    });

    it('버전 사슬을 LEFT JOIN 으로 붙인다', () => {
      const sql = sqlOf();
      expect(sql).toContain('left join "product_master_variants"');
      expect(sql).toContain('left join "product_master_versions"');
      expect(sql).toContain('left join "product_masters"');
    });

    it('리스팅과 채널로만 좁힌다', () => {
      const sql = sqlOf();
      expect(sql).toContain('"channel_variant_listings"."channel_item_id" = ');
      expect(sql).toContain('"sales_channels"."site" = ');
    });
  });

  describe('우선순위', () => {
    const healthy: ChannelListingDiagnosisRow = {
      listingIsActive: true,
      channelIsActive: true,
      variantStatus: 'active',
      versionStatus: 'active',
      versionDeletedAt: null,
      masterDeletedAt: null,
      hasVersionLink: true,
    };

    it('행이 없으면 listing_not_found', () => {
      expect(causeFromDiagnosisRow(undefined)).toBe('listing_not_found');
    });

    it('꺼진 리스팅은 listing_inactive', () => {
      expect(causeFromDiagnosisRow({ ...healthy, listingIsActive: false })).toBe('listing_inactive');
    });

    it('꺼진 채널은 channel_inactive', () => {
      expect(causeFromDiagnosisRow({ ...healthy, channelIsActive: false })).toBe('channel_inactive');
    });

    it('soft delete 된 마스터는 product_deleted', () => {
      expect(causeFromDiagnosisRow({ ...healthy, masterDeletedAt: new Date() })).toBe('product_deleted');
    });

    it('soft delete 된 버전도 product_deleted', () => {
      expect(causeFromDiagnosisRow({ ...healthy, versionDeletedAt: new Date() })).toBe('product_deleted');
    });

    it('활성 아닌 버전은 no_active_version', () => {
      expect(causeFromDiagnosisRow({ ...healthy, versionStatus: 'draft' })).toBe('no_active_version');
    });

    it('어떤 버전에도 안 매달린 품목은 no_active_version', () => {
      expect(causeFromDiagnosisRow({ ...healthy, hasVersionLink: false, versionStatus: null })).toBe(
        'no_active_version',
      );
    });

    it('판매중지 품목은 variant_inactive', () => {
      expect(causeFromDiagnosisRow({ ...healthy, variantStatus: 'inactive' })).toBe('variant_inactive');
    });

    it('삭제가 판매중지보다 앞선다 — 조치가 재매핑 하나이기 때문', () => {
      expect(
        causeFromDiagnosisRow({ ...healthy, masterDeletedAt: new Date(), variantStatus: 'inactive' }),
      ).toBe('product_deleted');
    });

    it('리스팅 비활성이 채널 비활성보다 앞선다 — 더 좁은 조치가 먼저다', () => {
      expect(causeFromDiagnosisRow({ ...healthy, listingIsActive: false, channelIsActive: false })).toBe(
        'listing_inactive',
      );
    });

    it('전부 정상인데 조회가 0행이었다면 unknown', () => {
      // 여기 오면 sellable 조회와 진단이 어긋난 것이다. 사유를 지어내지 않는다.
      expect(causeFromDiagnosisRow(healthy)).toBe('unknown');
    });
  });
});
