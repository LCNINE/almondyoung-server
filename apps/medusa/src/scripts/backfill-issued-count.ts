import type { ExecArgs } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../modules/promotion-meta';
import type PromotionMetaModuleService from '../modules/promotion-meta/service';

const CONFIRM_VALUE = 'backfill-issued-count';

/**
 * promotion_meta.issued_count 를 실제 customer↔promotion 링크 수로 정합화한다.
 *
 * 배경: issued_count 는 마이그레이션에서 0으로 시작한다(모듈 service.ts 주석 참조).
 * 마이그레이션 이전에 발급된 프로모션은 링크는 있으나 issued_count=0 → reserveClaimSlot 가
 * max_claims 를 실제보다 낮게 인식해 초과 발급될 수 있다(감사 P2-6). 이 스크립트로 1회 정합화.
 *
 * 사용:
 *   dry-run(기본):  medusa exec ./src/scripts/backfill-issued-count.ts
 *   실제 반영:      ISSUED_COUNT_BACKFILL_DRY_RUN=false ISSUED_COUNT_BACKFILL_CONFIRM=backfill-issued-count \
 *                   medusa exec ./src/scripts/backfill-issued-count.ts
 */
export default async function backfillIssuedCount({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const promotionMetaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const dryRun = process.env.ISSUED_COUNT_BACKFILL_DRY_RUN !== 'false';
  const confirm = process.env.ISSUED_COUNT_BACKFILL_CONFIRM;
  if (!dryRun && confirm !== CONFIRM_VALUE) {
    throw new Error(
      `Set ISSUED_COUNT_BACKFILL_CONFIRM=${CONFIRM_VALUE} when ISSUED_COUNT_BACKFILL_DRY_RUN=false`,
    );
  }

  const linkModule = (link as any).getLinkModule(
    Modules.CUSTOMER,
    'customer_id',
    Modules.PROMOTION,
    'promotion_id',
  );

  // max_claims 가 설정된 프로모션만 대상 — 상한이 없으면 issued_count 는 카운트 정보일 뿐.
  const metas = await (promotionMetaService as any).listPromotionMetas({});
  const targets = (metas as any[]).filter((m) => m.max_claims != null);

  logger.info(
    `[issued-count-backfill] mode=${dryRun ? 'dry-run' : 'write'} candidates=${targets.length}`,
  );

  let corrected = 0;
  for (const meta of targets) {
    const promotionId = meta.promotion_id as string;
    const links = (await linkModule.list(
      { promotion_id: promotionId },
      { select: ['customer_id'] },
    )) as any[];
    const actual = links.length;
    const current = Number(meta.issued_count ?? 0);
    if (actual === current) continue;

    corrected++;
    logger.info(
      `[issued-count-backfill] promotion=${promotionId} issued_count ${current} -> ${actual} (max_claims=${meta.max_claims})`,
    );
    if (!dryRun) {
      await promotionMetaService.setIssuedCount(promotionId, actual);
    }
  }

  logger.info(
    `[issued-count-backfill] done mode=${dryRun ? 'dry-run' : 'write'} corrected=${corrected}/${targets.length}`,
  );
}
