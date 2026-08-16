-- ADR-0031 결정 7: `sales_channels.site` 의 어휘를 `SalesChannel`(medusa | naver | coupang | 3pl)
-- 하나로 맞춘다.
--
-- 왜 필요한가: 채널 리스팅 조회가 `eq(sales_channels.site, channelCode)` 로 **대소문자를 그대로**
-- 비교하는데, 어댑터는 소문자를 내고 시드는 `'MEDUSA'` 를 넣어 왔다. 둘이 만나지 못하면 조회는
-- 예외 없이 0행을 내고, 그 채널 주문은 전량 미식별로 격리된다. 라이브 영향은 아직 없다 —
-- Medusa 수집은 이 조회를 타지 않고 variant metadata 를 직접 읽기 때문이다. 네이버·쿠팡을 켜는
-- 순간 문제가 된다.
--
-- destructive 아님(값 정규화). 컬럼은 varchar 로 두고 어휘는 애플리케이션이 막는다 — DB enum 으로
-- 올리면 destructive 3 PR 이 되고, 값이 더 늘어날 여지가 있어 이르다.

-- 1) 대소문자 정규화.
UPDATE sales_channels SET site = lower(site) WHERE site <> lower(site);
--> statement-breakpoint

-- 2) 어댑터·UI 어휘를 정본으로 옮긴다. 2026-08-16 프로덕션 실측에는 이 값들이 없었지만(행 1개,
--    `MEDUSA`), dev/stage 에는 운영자가 어드민에서 자유 문자열로 넣은 값이 남아 있을 수 있다.
UPDATE sales_channels SET site = 'naver'  WHERE site IN ('naver_smartstore', 'smartstore');
--> statement-breakpoint
UPDATE sales_channels SET site = 'medusa' WHERE site IN ('almondyoung', 'almond_young');
--> statement-breakpoint
UPDATE sales_channels SET site = '3pl'    WHERE site IN ('phone_order', 'phoneorder');
--> statement-breakpoint

-- 3) 남은 것이 있으면 **크게 실패한다.** `other` 처럼 대응물이 없는 값은 사람이 판정해야 한다.
--    조용히 두면 그 채널의 리스팅 조회만 0행을 내는, 알아채기 어려운 상태로 되돌아간다.
--    migrate 가 deploy 앞에 서므로(expand phase), 여기서 멈추는 편이 안전하다.
DO $$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(format('%s(site=%L)', id, site), ', ')
    INTO offenders
    FROM sales_channels
   WHERE site NOT IN ('medusa', 'naver', 'coupang', '3pl');

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'sales_channels.site 가 SalesChannel 어휘 밖입니다: %. 사람이 값을 판정한 뒤 이 마이그레이션을 다시 실행하세요 (ADR-0031 결정 7).',
      offenders;
  END IF;
END $$;
