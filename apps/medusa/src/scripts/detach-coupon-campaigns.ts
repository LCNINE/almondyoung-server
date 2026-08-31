import type { ExecArgs, IPromotionModuleService } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../modules/promotion-meta';
import type PromotionMetaModuleService from '../modules/promotion-meta/service';

const CONFIRM_VALUE = 'detach-coupon-campaigns';

/**
 * 캠페인 날짜를 쓰던 옛 쿠폰을 새 모델로 넘긴다 (#488 결정 1, 배포 후 1회).
 *
 * 하는 일 넷:
 *  ① `promotion_meta` 행이 있는 프로모션의 `campaign.starts_at`/`ends_at` 을 비운다.
 *     (값은 마이그레이션 `Migration20260831100000` 이 이미 `promotion_meta` 로 백필했다.)
 *  ② 그 프로모션의 `campaign_id` 를 뗀다.
 *  ③ 아무 프로모션도 안 붙었고 예산도 없는 기계 생성 `CAMP_%` 캠페인을 지운다.
 *  ④ `expires_at` 이 비어 있는 기존 링크 행을 정책값(`promotion_meta.ends_at`)으로 백필한다 —
 *     안 하면 이 변경 전에 발급된 쿠폰이 영원히 무기한이 된다(`validity.ts` 의 fail-open).
 *
 * **예산(`budget`)이 붙은 캠페인은 건드리지 않는다** — 캠페인은 예산이 필요할 때 계속 쓴다.
 * **다른 프로모션이 아직 붙어 있는 캠페인도 건드리지 않는다** — ③ 참고.
 *
 * 이 쓰기가 마이그레이션이 아니라 스크립트인 이유: `promotion`·`promotion_campaign` 은
 * 코어 프로모션 모듈 소유 테이블이고, 우리 모듈 마이그레이션이 그것을 UPDATE 하면 모듈
 * 격리를 어기며 `down()` 이 복원 불가다.
 *
 * 사용:
 *   dry-run(기본):  medusa exec ./src/scripts/detach-coupon-campaigns.ts
 *   실제 반영:      DETACH_CAMPAIGNS_DRY_RUN=false DETACH_CAMPAIGNS_CONFIRM=detach-coupon-campaigns \
 *                   medusa exec ./src/scripts/detach-coupon-campaigns.ts
 */
export default async function detachCouponCampaigns({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  // ContainerRegistrationKeys.LINK 는 컨테이너에 좁은 타입이 없어 resolve() 가 unknown 을
  // 반환한다 — `.getLinkModule`/`.create` 를 부르려면 캐스팅이 필요하다. 이 저장소 전체가
  // 이 자리에서 이미 그렇게 한다(backfill-issued-count.ts, admin/promotions 라우트 등).
  const link = container.resolve(ContainerRegistrationKeys.LINK) as any;
  const promotionModule = container.resolve<IPromotionModuleService>(Modules.PROMOTION);
  const metaService = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

  const dryRun = process.env.DETACH_CAMPAIGNS_DRY_RUN !== 'false';
  const confirm = process.env.DETACH_CAMPAIGNS_CONFIRM;
  if (!dryRun && confirm !== CONFIRM_VALUE) {
    throw new Error(`Set DETACH_CAMPAIGNS_CONFIRM=${CONFIRM_VALUE} when DETACH_CAMPAIGNS_DRY_RUN=false`);
  }
  logger.info(`[detach-coupon-campaigns] mode=${dryRun ? 'dry-run' : 'write'}`);

  // ── ①② 메타가 있는 프로모션의 캠페인을 비우고 뗀다 ──
  const { data: promotionsData } = await query.graph({
    entity: 'promotion',
    fields: [
      'id',
      'code',
      'campaign_id',
      'campaign.id',
      'campaign.campaign_identifier',
      'campaign.starts_at',
      'campaign.ends_at',
      'campaign.budget.id',
    ],
    filters: {},
  });
  const promotions = promotionsData as any[];

  const metas = await metaService.getByPromotionIds(promotions.map((p) => p.id));
  const metaByPromotionId = new Map(metas.map((m) => [m.promotion_id, m]));

  const toDetach = promotions.filter((p) => p.campaign_id && metaByPromotionId.has(p.id));
  logger.info(`[detach-coupon-campaigns] 캠페인이 붙은 메타 보유 프로모션: ${toDetach.length}건`);
  for (const p of toDetach) {
    const c = p.campaign;
    logger.info(
      `[detach-coupon-campaigns]   - ${p.code} → campaign ${c?.campaign_identifier ?? p.campaign_id} ` +
        `(starts=${c?.starts_at ?? '-'}, ends=${c?.ends_at ?? '-'}, budget=${c?.budget?.id ? 'Y' : 'N'})`,
    );
  }

  if (!dryRun) {
    for (const p of toDetach) {
      if (p.campaign?.id) {
        await promotionModule.updateCampaigns([{ id: p.campaign.id, starts_at: null, ends_at: null }]);
      }
      await promotionModule.updatePromotions([{ id: p.id, campaign_id: null }]);
    }
  }

  // ── ③ 고아가 된 기계 생성 캠페인 삭제 (예산 있는 것 / 다른 프로모션이 남은 것은 건드리지 않는다) ──
  //
  // 🔴 "이번에 뗀 프로모션이 물려 있던 캠페인" 만으로 지우면 안 된다 — `campaign.promotions` 는
  // hasMany 라 메타 없는 다른 프로모션이 같은 캠페인에 *아직* 붙어 있을 수 있다. 그 경우 지우면
  // 그 프로모션의 `campaign_id` 가 고아 FK 로 남는다. 그래서 "이번에 떼지 않는 프로모션이
  // 하나라도 남아 있는가" 를 전체 promotions 스냅샷에서 다시 세어 확인한다.
  const toDetachIds = new Set(toDetach.map((p) => p.id));
  const remainingPromotionCountByCampaignId = new Map<string, number>();
  for (const p of promotions) {
    if (p.campaign_id && !toDetachIds.has(p.id)) {
      remainingPromotionCountByCampaignId.set(
        p.campaign_id,
        (remainingPromotionCountByCampaignId.get(p.campaign_id) ?? 0) + 1,
      );
    }
  }
  const detachedCampaigns = [
    ...new Map(toDetach.filter((p) => p.campaign?.id).map((p) => [p.campaign.id, p.campaign])).values(),
  ];
  const orphans = detachedCampaigns.filter(
    (c) =>
      !remainingPromotionCountByCampaignId.has(c.id) &&
      String(c.campaign_identifier ?? '').startsWith('CAMP_') &&
      !c.budget?.id,
  );
  logger.info(
    `[detach-coupon-campaigns] 삭제 대상 기계 생성 캠페인(예산 없음, 다른 프로모션 없음): ${orphans.length}건`,
  );
  for (const c of orphans) {
    logger.info(`[detach-coupon-campaigns]   - ${c.campaign_identifier} (${c.id})`);
  }
  if (!dryRun && orphans.length) {
    await promotionModule.deleteCampaigns(orphans.map((c) => c.id));
  }

  // ── ④ expires_at 이 비어 있는 링크 행 백필 ──
  //
  // 정책의 `ends_at` 만 쓰고 `validity_days` 는 안 쓴다 — 이 링크들은 이 브랜치 이전
  // (캠페인 날짜가 유일한 만료 개념이던 시절)에 발급됐다. `validity_days`(발급일+N일)는 이
  // 브랜치가 새로 도입한 개념이라 과거엔 그렇게 계산된 적이 없다. `computeExpiresAt()` 을
  // 그대로 쓰면 `validity_days` 가 `ends_at` 보다 우선해 존재하지 않았던 의미를 소급 적용하게
  // 된다 — 그래서 여기서는 `computeExpiresAt` 을 쓰지 않고 `ends_at` 만 직접 읽는다.
  //
  // `link.create` 는 upsert 지만 `data` 에 넣은 키만 갱신한다(RemoteLink 가 지정된 키만
  // 엔티티에 실어 올리고, 나머지는 SQL 에 아예 포함되지 않는다 — 링크당 한 건씩 호출하므로
  // 배치 열 불일치도 없다). `expires_at` 하나만 넣으면 `used_at`/`order_id`/`issued_via` 는
  // 손대지 않는다 — integration-tests/http/coupon-validity.spec.ts 의 T3("dismiss 후
  // create") 케이스가 이 부분 갱신 의미론을 실측한다.
  const linkModule = link.getLinkModule(Modules.CUSTOMER, 'customer_id', Modules.PROMOTION, 'promotion_id');
  const allLinks = (await linkModule.list({}, { select: ['customer_id', 'promotion_id', 'expires_at'] })) as any[];
  const needBackfill = allLinks.filter((l) => l.expires_at == null);
  const backfillable = needBackfill
    .map((l) => ({ l, endsAt: metaByPromotionId.get(l.promotion_id)?.ends_at ?? null }))
    .filter((x) => x.endsAt != null);
  logger.info(
    `[detach-coupon-campaigns] expires_at 이 빈 링크 ${needBackfill.length}건 중 ` +
      `정책값으로 채울 수 있는 것 ${backfillable.length}건`,
  );
  if (!dryRun) {
    for (const { l, endsAt } of backfillable) {
      await link.create([
        {
          [Modules.CUSTOMER]: { customer_id: l.customer_id },
          [Modules.PROMOTION]: { promotion_id: l.promotion_id },
          data: { expires_at: new Date(endsAt) },
        },
      ]);
    }
  }

  logger.info(
    dryRun
      ? '[detach-coupon-campaigns] dry-run 끝. 반영하려면 환경변수를 주십시오.'
      : '[detach-coupon-campaigns] 반영 끝.',
  );
}
