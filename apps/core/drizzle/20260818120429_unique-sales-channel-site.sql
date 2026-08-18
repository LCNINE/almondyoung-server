-- `sales_channels.site` 를 유일하게 만든다 (#668 항목 1).
--
-- 왜 필요한가: 주문 수집이 타는 진입점은 `lookupVariantByChannelCode(site, channelItemId)` 인데
-- `uq_channel_variant_listing` 은 `(sales_channel_id, channel_item_id)` 라 **두 채널이 같은
-- `channelItemId` 매핑을 각각 가질 수 있다.** `site='naver'` 행이 둘이면 조회가 `limit 1` 로
-- 둘 중 하나를 임의로 골라 A 채널 주문이 B 채널 매핑의 variant 로 해석된다 — 격리도 로그도
-- 없이 다른 상품의 판매주문이 생긴다.
--
-- 새 제약을 도입하는 게 아니라 **이미 있는 전제를 적는 것**이다. 어휘는 `SalesChannel`
-- (medusa|naver|coupang|3pl) 넷으로 닫혀 있고(ADR-0031 결정 7, 20260816201037), 네이버·쿠팡
-- 크레덴셜은 배포당 하나인 env 이며(`NAVER_CLIENT_ID` 등), 워터마크(`sync_status.channel_id`)·
-- 주문 매핑(`wms_order_mappings.sales_channel`)·격리 큐(`pending_orders.channel`)가 전부
-- `sales_channel_id` 가 아니라 site 문자열 한 벌로 키잉돼 있다. 즉 "site 하나 = 스토어 하나"는
-- 시스템 전체가 이미 전제하고 있고 DB 만 그걸 안 지키고 있었다.
--
-- 순서: **`sst deploy` → 이 마이그레이션.** 위반을 409 로 옮기는 코드가 먼저 떠 있어야
-- 한다. 반대로 하면 그 사이에 생긴 중복 시도가 500 으로 새어나간다 (읽는 쪽은 영향 없다).

-- 1) 중복이 있으면 **크게 실패한다.** `CREATE UNIQUE INDEX` 도 어차피 실패하지만 어느 행이
--    범인인지 알려주지 않는다. 어느 채널을 남길지는 사람이 판정해야 한다 — 리스팅
--    (`channel_variant_listings.sales_channel_id`)이 어느 쪽에 붙어 있는지에 달렸고, 지우는
--    쪽의 리스팅은 cascade 로 함께 사라진다.
DO $$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(format('site=%L → %s개(%s)', site, cnt, ids), '; ')
    INTO offenders
    FROM (
      SELECT site, count(*) AS cnt, string_agg(id::text, ', ' ORDER BY created_at) AS ids
        FROM sales_channels
       GROUP BY site
      HAVING count(*) > 1
    ) dup;

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'sales_channels.site 에 중복이 있습니다: %. 남길 채널을 사람이 고른 뒤(지우는 쪽의 channel_variant_listings 는 cascade 로 함께 삭제됩니다) 이 마이그레이션을 다시 실행하세요 (#668 항목 1).',
      offenders;
  END IF;
END $$;
--> statement-breakpoint

-- 2) 평범 인덱스를 유일 인덱스로 바꾼다. 유일 인덱스가 조회 인덱스 역할도 하므로 옛 것은 없앤다.
DROP INDEX "idx_sales_channels_site";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sales_channels_site" ON "sales_channels" USING btree ("site");
