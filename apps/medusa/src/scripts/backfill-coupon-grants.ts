import type { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../modules/promotion-meta';
import type PromotionMetaModuleService from '../modules/promotion-meta/service';
import type { IssueTrigger } from '../modules/promotion-meta/service';

const CONFIRM_VALUE = 'backfill-coupon-grants';

/**
 * 기존 customer↔promotion 링크 행을 `coupon_grant` 1장씩으로 이관한다 (1회용).
 *
 * 왜 마이그레이션이 아닌가: 링크 테이블의 **실제 이름이 우리 소스에 없다.** 부팅 시
 * `medusa db:migrate --execute-safe-links` 가 만들고 마이그레이션 파일이 남지 않는다.
 * 추측한 이름으로 SQL 을 쓰면 배포 중에 죽는다. 링크 «모듈 API» 를 쓰면 이름을 몰라도 된다
 * (`backfill-issued-count.ts` 와 같은 패턴).
 *
 * `issue_key` 는 결정적으로 만든다 — 원본이 복합 PK 라 (쿠폰, 고객) 쌍마다 정확히 한 행이고
 * 유니크는 그 쌍에 키를 더한 삼중이므로, 관리자 발급분은 `'legacy'` 고정으로 충분하다.
 * 이후 관리자 발급은 제출 UUID 키를 쓰므로 `'legacy'` 와 절대 충돌하지 않는다.
 *
 * 멱등하다 — 같은 키로 두 번 돌리면 grant 생성은 유니크가 막아 `duplicate` 로 건너뛰고,
 * 사용 상태 이관은 `markGrantUsedIfUnused` 가 "아직 미사용일 때만" 갱신해 멱등하다. 이 둘을
 * 하나의 `if (result === 'duplicate') continue` 로 묶으면 안 된다 — grant 생성 성공 뒤
 * 사용 상태 이관 전에 스크립트가 중단되면, 재실행에서 `'duplicate'` 로 스킵되어 그 grant 는
 * 영원히 미사용으로 남는다(이미 쓴 쿠폰을 고객이 한 번 더 쓸 수 있게 된다). 그래서 사용 상태
 * 이관은 `result` 와 무관하게 매번 시도한다.
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

  let created = 0;
  let duplicate = 0;
  let usageSynced = 0;
  for (const l of rows) {
    const issuedVia: IssueTrigger = (l.issued_via as IssueTrigger) ?? 'admin_manual';
    const issueKey =
      issuedVia === 'customer_claim'
        ? 'claim'
        : issuedVia === 'customer_registered' || issuedVia === 'membership_activated'
        ? `trigger:${issuedVia}`
        : 'legacy';

    if (dryRun) {
      logger.info(
        `[grant-backfill] would create promotion=${l.promotion_id} customer=${l.customer_id} key=${issueKey}`,
      );
      created++;
      continue;
    }

    const result = await promotionMetaService.issueGrant({
      promotion_id: l.promotion_id,
      customer_id: l.customer_id,
      issue_key: issueKey,
      issued_via: issuedVia,
      expires_at: l.expires_at ? new Date(l.expires_at) : null,
      now: l.created_at ? new Date(l.created_at) : new Date(),
    });
    if (result === 'duplicate') {
      duplicate++;
    } else {
      created++;
    }

    // 옛 링크가 이미 사용된 장이었다면 사용 기록도 옮긴다. `result` 와 무관하게 매번 시도한다 —
    // 'duplicate' 는 "이 실행에서 grant 를 안 만들었다"는 뜻이지 "사용 상태까지 이미 옮겨졌다"는
    // 뜻이 아니다(중단-재실행 케이스, 위 docblock 참고). `markGrantUsedIfUnused` 가 이미 채워진
    // 값은 건드리지 않으므로 몇 번을 불러도 안전하다.
    if (l.used_at) {
      const outcome = await promotionMetaService.markGrantUsedIfUnused(
        l.promotion_id,
        l.customer_id,
        issueKey,
        l.order_id ?? 'legacy',
        new Date(l.used_at),
      );
      if (outcome === 'consumed') usageSynced++;
    }
  }

  logger.info(
    `[grant-backfill] done mode=${dryRun ? 'dry-run' : 'write'} created=${created} duplicate=${duplicate} usageSynced=${usageSynced}`,
  );
}
