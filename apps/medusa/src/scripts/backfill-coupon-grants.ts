import type { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../modules/promotion-meta';
import type PromotionMetaModuleService from '../modules/promotion-meta/service';
import type { IssueTrigger } from '../modules/promotion-meta/service';
import type { CouponGrantRow } from '../modules/promotion-meta/service';

const CONFIRM_VALUE = 'backfill-coupon-grants';

/**
 * 기존 customer↔promotion 링크 행을 `coupon_grant` 1장씩으로 이관한다 (1회용).
 *
 * 왜 마이그레이션이 아닌가: 링크 테이블의 **실제 이름이 우리 소스에 없다.** 부팅 시
 * `medusa db:migrate --execute-safe-links` 가 만들고 마이그레이션 파일이 남지 않는다.
 * 추측한 이름으로 SQL 을 쓰면 배포 중에 죽는다. 링크 «모듈 API» 를 쓰면 이름을 몰라도 된다.
 *
 * `issue_key` 는 결정적으로 만든다 — 원본이 복합 PK 라 (쿠폰, 고객) 쌍마다 정확히 한 행이고
 * 유니크는 그 쌍에 키를 더한 삼중이므로, 관리자 발급분은 `'legacy'` 고정으로 충분하다.
 * 이후 관리자 발급은 제출 UUID 키를 쓰므로 `'legacy'` 와 절대 충돌하지 않는다.
 *
 * **멱등의 정확한 범위 — 「같은 키」가 아니라 「(쿠폰, 고객) 쌍」이 기준이다.**
 *
 * 🔴 유니크 인덱스만 믿으면 **개통 후 재실행이 공짜 쿠폰을 찍어낸다.** 배포 후 `link.create`
 * 는 더 이상 `data` 를 쓰지 않으므로 그 뒤에 생긴 링크 행은 `issued_via = NULL` →
 * `'admin_manual'` → `issue_key = 'legacy'` 로 떨어진다. 그런데 라이브 발급이 실제로 쓴 키는
 * `${submit_id}:${n}` 이라 그 쌍에 `'legacy'` grant 는 **존재하지 않는다** — 키만 보는
 * `issueGrant` 의 유니크는 이것을 중복으로 못 읽고, 개통 이후 무언가를 발급받은 고객
 * 전원에게 장을 한 장씩 더 만들어 준다.
 *
 * 그래서 건너뛰기 판정은 **그 쌍에 살아있는 장이 하나라도 있는가**다(회수된 장은
 * soft-delete 되어 `listCouponGrants` 에 안 잡히므로, 회수 후 재실행은 정상적으로 다시
 * 만든다). 이 판정은 dry-run 에도 그대로 적용된다 — 안 그러면 부분 반영 후의 dry-run 이
 * "만들 개수"를 부풀려, 배포 노트가 시키는 「dry-run 수와 대조」가 무의미해진다.
 *
 * 사용 상태 이관은 **생성 여부와 무관하게 매번 시도한다.** 생성
 * 성공 뒤 이관 전에 스크립트가 중단되면, 재실행에서 스킵되어 그 grant 가 영원히 미사용으로
 * 남기 때문이다(이미 쓴 쿠폰을 고객이 한 번 더 쓸 수 있게 된다). 이관 자체는 "아직 미사용일
 * 때만" 갱신이라 몇 번을 불러도 안전하고, 키가 안 맞으면 `not_found` 로 조용히 지나간다.
 *
 * 사용:
 *   dry-run(기본):  medusa exec ./src/scripts/backfill-coupon-grants.ts
 *   실제 반영:      GRANT_BACKFILL_DRY_RUN=false GRANT_BACKFILL_CONFIRM=backfill-coupon-grants \
 *                   medusa exec ./src/scripts/backfill-coupon-grants.ts
 */
export default async function backfillCouponGrants({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const promotionMetaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const dryRun = process.env.GRANT_BACKFILL_DRY_RUN !== 'false';
  if (!dryRun && process.env.GRANT_BACKFILL_CONFIRM !== CONFIRM_VALUE) {
    throw new Error(`Set GRANT_BACKFILL_CONFIRM=${CONFIRM_VALUE} when GRANT_BACKFILL_DRY_RUN=false`);
  }

  const linkModule = (link as any).getLinkModule(
    Modules.CUSTOMER,
    'customer_id',
    Modules.PROMOTION,
    'promotion_id',
  );

  const rows = (await linkModule.list(
    {},
    { select: ['customer_id', 'promotion_id', 'created_at', 'expires_at', 'used_at', 'order_id', 'issued_via'] },
  )) as any[];

  logger.info(`[grant-backfill] mode=${dryRun ? 'dry-run' : 'write'} links=${rows.length}`);

  // 이미 장을 가진 «쌍» 을 먼저 통째로 읽어 둔다 — 링크 행마다 조회하지 않도록 프로모션
  // 단위로 묶는다(서로 다른 프로모션 수는 링크 수보다 훨씬 작다). 위 docblock 의 재실행
  // 안전판이 여기에 선다.
  const promotionIds = [...new Set(rows.map((l) => l.promotion_id as string))];
  const pairsWithGrant = new Set<string>();
  for (const promotionId of promotionIds) {
    for (const g of await promotionMetaService.listGrantsForPromotion(promotionId)) {
      pairsWithGrant.add(`${g.promotion_id}|${g.customer_id}`);
    }
  }
  logger.info(`[grant-backfill] pairs already holding a grant=${pairsWithGrant.size}`);

  let created = 0;
  let duplicate = 0;
  let skippedExisting = 0;
  let usageSynced = 0;
  for (const l of rows) {
    const issuedVia: IssueTrigger = (l.issued_via as IssueTrigger) ?? 'admin_manual';
    const issueKey =
      issuedVia === 'customer_claim'
        ? 'claim'
        : issuedVia === 'customer_registered' || issuedVia === 'membership_activated'
        ? `trigger:${issuedVia}`
        : 'legacy';

    const pairKey = `${l.promotion_id}|${l.customer_id}`;
    const hasLiveGrant = pairsWithGrant.has(pairKey);

    if (dryRun) {
      // dry-run 도 같은 판정을 쓴다 — 그래야 "만들 개수"가 실제 반영 후에 0 으로 수렴한다.
      if (hasLiveGrant) {
        skippedExisting++;
      } else {
        logger.info(
          `[grant-backfill] would create promotion=${l.promotion_id} customer=${l.customer_id} key=${issueKey}`,
        );
        created++;
      }
      continue;
    }

    if (hasLiveGrant) {
      // 이 쌍은 이미 장을 가졌다. 키가 다르더라도 만들지 않는다 — 그게 개통 후 재실행이
      // 공짜 쿠폰을 찍어내던 자리다.
      skippedExisting++;
    } else {
      const result = await promotionMetaService.issueGrantWithSlot({
        promotion_id: l.promotion_id,
        customer_id: l.customer_id,
        issue_key: issueKey,
        issued_via: issuedVia,
        expires_at: l.expires_at ? new Date(l.expires_at) : null,
        now: l.created_at ? new Date(l.created_at) : new Date(),
        // 백필은 상한을 집행하지 않는다 — 옛 링크는 이미 «발급된 사실»이다. `max_claims: null`
        // 이라 카운터 미러도 건드리지 않는다(정합화는 PR 본문의 SQL 한 방이 한다).
        max_claims: null,
        enforce_cap: false,
      });
      if (result === 'duplicate') {
        // 프리로드 이후에 누가 같은 키로 먼저 넣은 경우. 유니크가 여전히 최종 권위다.
        duplicate++;
      } else {
        created++;
      }
      pairsWithGrant.add(pairKey);
    }

    // 옛 링크가 이미 사용된 장이었다면 사용 기록도 옮긴다. **생성 여부와 무관하게 매번
    // 시도한다** — 「안 만들었다」가 「사용 상태까지 이미 옮겨졌다」는 뜻은 아니다(중단-재실행
    // 케이스, 위 docblock 참고). 키가 안 맞는 쌍(개통 후 발급분)은 `not_found` 로 조용히
    // 지나가고, 이미 채워진 값은 건드리지 않으므로 몇 번을 불러도 안전하다.
    if (l.used_at) {
      // 옛 사용 상태 이관 전용 메서드(백필만 부르던 것)의 본체를 여기로 — 이 스크립트가
      // 유일한 호출자였다. 키로 찾고 「미사용일 때만」은 `consumeGrantIfUnused` 의 SQL
      // 술어가 지킨다(조회를 믿고 덮어쓰지 않는다). 키가 안 맞는 쌍(개통 후 발급분)은
      // 조용히 지나가고 이미 채워진 값은 건드리지 않으므로 몇 번을 불러도 안전하다.
      const [grant] = (await promotionMetaService.listCouponGrants({
        promotion_id: l.promotion_id,
        customer_id: l.customer_id,
        issue_key: issueKey,
      })) as CouponGrantRow[];
      if (grant && grant.used_at == null) {
        const consumed = await promotionMetaService.consumeGrantIfUnused(
          grant.id,
          l.order_id ?? 'legacy',
          new Date(l.used_at),
        );
        if (consumed) usageSynced++;
      }
    }
  }

  logger.info(
    `[grant-backfill] done mode=${dryRun ? 'dry-run' : 'write'} created=${created} ` +
      `skippedExisting=${skippedExisting} duplicate=${duplicate} usageSynced=${usageSynced}`,
  );
}
