import { getTableConfig } from 'drizzle-orm/pg-core';
import { SALES_CHANNEL_SITE_UNIQUE_INDEX, salesChannels } from '../../schema/catalog.schema';
import { isSalesChannelSiteConflict } from './sales-channel-site-conflict';

/**
 * `sales_channels.site` 는 유일해야 한다 (#668 항목 1).
 *
 * 주문 수집이 타는 진입점은 `lookupVariantByChannelCode(site, channelItemId)` 이고,
 * `uq_channel_variant_listing` 은 `(sales_channel_id, channel_item_id)` 라 **같은 site 행이
 * 둘이면 A 채널 주문이 B 채널 매핑의 variant 로 해석된다** — 격리도 로그도 없이 다른 상품의
 * 판매주문이 생긴다. 어휘가 `SalesChannel`(medusa|naver|coupang|3pl) 넷으로 닫혀 있고
 * (ADR-0031 결정 7) 크레덴셜·워터마크·주문 매핑이 전부 site 문자열 한 벌로 키잉돼 있으므로,
 * "site 하나 = 스토어 하나"는 이미 시스템 전체의 전제다. DB 만 그걸 안 지키고 있었다.
 *
 * 검사는 DB 가 한다(경쟁 조건 없는 유일한 자리). 여기서는 그 인덱스가 스키마에서
 * 사라지지 않았는지와, 위반이 500 이 아니라 409 로 나가는지를 지킨다.
 */
describe('판매채널 site 유일성 (#668)', () => {
  describe('스키마 계약', () => {
    it('site 에 unique 인덱스가 걸려 있다', () => {
      // 인덱스 항목은 컬럼일 수도 식일 수도 있어(`IndexedColumn | SQL`) 이름 유무로 좁힌다.
      const columnNamesOf = (index: { config: { columns: readonly unknown[] } }): string[] =>
        index.config.columns.flatMap((column) =>
          column !== null && typeof column === 'object' && 'name' in column && typeof column.name === 'string'
            ? [column.name]
            : [],
        );

      const siteIndexes = getTableConfig(salesChannels).indexes.filter((index) => {
        const names = columnNamesOf(index);
        return names.length === 1 && names[0] === 'site';
      });

      expect(siteIndexes).toHaveLength(1);
      expect(siteIndexes[0].config.unique).toBe(true);
      expect(siteIndexes[0].config.name).toBe(SALES_CHANNEL_SITE_UNIQUE_INDEX);
    });
  });

  describe('위반 분류', () => {
    // drizzle-orm 0.44.x 는 driver 에러를 DrizzleQueryError 로 감싼다 — 실제 postgres.js
    // PostgresError(code, constraint_name)는 최상위가 아니라 `.cause` 체인에 있다.
    function wrapped(depth: number, pgError: object): unknown {
      let current: unknown = pgError;
      for (let i = 0; i < depth; i += 1) {
        current = Object.assign(new Error('Failed query'), { cause: current });
      }
      return current;
    }

    const siteViolation = { code: '23505', constraint_name: SALES_CHANNEL_SITE_UNIQUE_INDEX };

    it('site unique 위반을 알아본다', () => {
      expect(isSalesChannelSiteConflict(siteViolation)).toBe(true);
    });

    it('drizzle 이 감싼 cause 체인 안쪽도 찾아낸다', () => {
      expect(isSalesChannelSiteConflict(wrapped(2, siteViolation))).toBe(true);
    });

    it('다른 unique 제약 위반은 site 충돌이 아니다', () => {
      const other = { code: '23505', constraint_name: 'uq_channel_variant_listing' };
      expect(isSalesChannelSiteConflict(wrapped(1, other))).toBe(false);
    });

    it('unique 위반이 아닌 에러는 그대로 흘려보낸다', () => {
      expect(isSalesChannelSiteConflict(new Error('connection reset'))).toBe(false);
      expect(isSalesChannelSiteConflict(wrapped(1, { code: '23503' }))).toBe(false);
      expect(isSalesChannelSiteConflict(null)).toBe(false);
    });
  });
});
