import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { catalogSchema, salesChannels } from '../../schema/catalog.schema';
import { DbClient } from '../../catalog.types';
import { buildChannelListingLookupQuery } from './channel-listing-lookup.query';

/**
 * 조회 술어의 **계약 잠금**이다 (#666).
 *
 * 이 술어가 검증되는 유일한 자리가 실 DB 통합 스펙인데, 그건 `DATABASE_URL` 이 없으면
 * 통째로 skip 되고 CI 게이트에는 DB 가 없다 — 즉 방어 코드를 통째로 지워도 게이트가
 * 초록이었다. 여기서는 SQL 문자열만 보므로 DB 없이 CI 에서 돈다.
 *
 * 의미(정말 걸러지는가)는 `channel-listing-lookup.integration.spec.ts` 가 실 Postgres 로 본다.
 * 이 스펙은 그 술어가 **사라지지 않았는지**만 지킨다.
 */
describe('채널 리스팅 조회 쿼리의 술어 계약 (#666)', () => {
  // 쿼리를 만들기만 하고 실행하지 않는다 — postgres.js 는 지연 연결이라 소켓이 열리지 않는다.
  const connection = postgres('postgres://spec:spec@127.0.0.1:1/none', { max: 1 });
  const client = drizzle(connection, { schema: catalogSchema }) as unknown as DbClient;

  afterAll(async () => {
    await connection.end({ timeout: 0 });
  });

  const sqlOf = () => buildChannelListingLookupQuery(client, 'item-1', eq(salesChannels.site, 'naver')).toSQL().sql;

  it('활성 버전만 통과시킨다', () => {
    expect(sqlOf()).toContain('"product_master_versions"."status" = ');
  });

  it('soft delete 된 버전과 마스터를 둘 다 배제한다', () => {
    const sql = sqlOf();
    expect(sql).toContain('"product_master_versions"."deleted_at" is null');
    expect(sql).toContain('"product_masters"."deleted_at" is null');
  });

  it('꺼진 리스팅을 배제한다', () => {
    expect(sqlOf()).toContain('"channel_variant_listings"."is_active" = ');
  });

  it('판매중지된 품목을 배제한다', () => {
    // `product_variants.status` 는 가용재고 계산이 판매 게이트로 쓰는 값이다
    // (product-sellable-quantity.calculator.ts). 조회가 이걸 안 보면 가용재고 0/판매불가인
    // 품목으로 채널 주문이 정상 수집돼 판매주문이 생성된다 (#670).
    expect(sqlOf()).toContain('"product_variants"."status" = ');
  });

  it('비활성 판매채널을 배제한다', () => {
    // 조회는 리스팅의 is_active 만 봤고 채널 자체의 is_active 는 안 봤다. 지금은 폴러 게이트
    // (#654/#660)가 수집을 먼저 막아 도달 경로가 없지만, 조회 자체는 열려 있었다 (#670 곁가지).
    expect(sqlOf()).toContain('"sales_channels"."is_active" = ');
  });

  it('마스터를 버전의 master_id 로 앵커한다', () => {
    // product_master_variants.master_id 는 버전의 것과 같다는 DB 제약이 없다.
    expect(sqlOf()).toContain('"product_masters" on "product_masters"."id" = "product_master_versions"."master_id"');
  });
});
