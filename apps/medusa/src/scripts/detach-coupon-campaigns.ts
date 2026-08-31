import type { ExecArgs, IPromotionModuleService } from '@medusajs/framework/types';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { PROMOTION_META_MODULE } from '../modules/promotion-meta';
import type PromotionMetaModuleService from '../modules/promotion-meta/service';

const CONFIRM_VALUE = 'detach-coupon-campaigns';

/**
 * 캠페인 날짜를 쓰던 옛 쿠폰을 새 모델로 넘긴다 (#488 결정 1, 배포 후 1회).
 *
 * 하는 일 넷:
 *  ① `promotion_meta` 행이 있고, 캠페인에 **예산이 없으며**, **다른 프로모션이 그 캠페인을
 *     더는 참조하지 않는** 프로모션만 골라 `campaign.starts_at`/`ends_at` 을 비운다.
 *     (값은 마이그레이션 `Migration20260831100000` 이 이미 `promotion_meta` 로 백필했다.)
 *  ② 메타가 있고 캠페인에 예산이 없는 프로모션의 `campaign_id` 를 뗀다. 이건 ①과 달리
 *     "다른 프로모션이 참조하는가"와 무관하게 항상 안전하다 — 프로모션 자신의 FK 를
 *     지우는 것뿐, 캠페인 행 자체는 건드리지 않는다.
 *  ③ 아무 프로모션도 안 붙었고 예산도 없는 기계 생성 `CAMP_%` 캠페인을 지운다.
 *  ④ `expires_at` 이 비어 있는 기존 링크 행을 정책값(`promotion_meta.ends_at`)으로 백필한다 —
 *     안 하면 이 변경 전에 발급된 쿠폰이 영원히 무기한이 된다(`validity.ts` 의 fail-open).
 *
 * **예산(`budget`)이 붙은 캠페인은 ①②③ 전부에서 건드리지 않는다** — campaign_id 도 날짜도
 * 그대로 둔다. 예산은 캠페인에만 붙는 Medusa 모델이라(프로모션엔 없다) 이런 프로모션은
 * `campaign.starts_at`/`ends_at` 을 엔진이 계속 필터링 근거로 쓰는데, 마이그레이션이 이미
 * 같은 값을 `promotion_meta` 로 복사해뒀으므로 두 축은 이미 일치한다 — 캠페인 날짜를 지우는
 * "정리"는 이 케이스에서 불필요하고, 지우면 예산(1인당 횟수·총 할인 한도)만 캠페인에 남긴 채
 * 프로모션을 떼어내 예산을 고아로 만드는 손해만 입힌다.
 *
 * **다른 프로모션이 아직 붙어 있는 캠페인의 날짜도 지우지 않는다(①만 해당, ②는 무관)** —
 * `campaign.promotions` 는 hasMany 라, 이번에 떼는 프로모션 말고 다른 프로모션(메타가 없는
 * 옛 코어 프로모션 등)이 같은 캠페인을 여전히 참조할 수 있다. 그 프로모션에겐 캠페인 날짜가
 * 유일한 만료 개념인데, 날짜를 지우면 창이 없는 `campaign_id` 만 남아 `listActivePromotions_`
 * 가 더는 걸러주지 않고 **영구히 유효**해진다. 이 판정(`remainingPromotionCountByCampaignId`
 * — "이번에 떼지 않는 프로모션이 이 캠페인을 아직 참조하는가")은 ③의 고아 캠페인 삭제 판정과
 * **완전히 같은 질문**이라, ③보다 앞으로 끌어와 ①의 날짜 삭제 가드에도 그대로 쓴다.
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

  // ── ①② 메타가 있는 프로모션 중 캠페인에 예산이 없는 것만 골라 뗀다 ──
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
  // 링크 로그에 promotion_id 옆에 사람이 읽을 code 를 같이 보여주기 위한 조회용 맵.
  const promotionCodeById = new Map(promotions.map((p) => [p.id, p.code]));

  const metas = await metaService.getByPromotionIds(promotions.map((p) => p.id));
  const metaByPromotionId = new Map(metas.map((m) => [m.promotion_id, m]));

  const hasCampaignAndMeta = (p: any) => p.campaign_id && metaByPromotionId.has(p.id);
  // 예산이 있는 캠페인은 ①②에서 완전히 제외한다 — campaign_id 도 날짜도 그대로 둔다(위 docblock 참고).
  const toDetach = promotions.filter((p) => hasCampaignAndMeta(p) && !p.campaign?.budget?.id);
  const budgetSkipped = promotions.filter((p) => hasCampaignAndMeta(p) && p.campaign?.budget?.id);

  logger.info(
    `[detach-coupon-campaigns] 캠페인이 붙은 메타 보유 프로모션: ${toDetach.length + budgetSkipped.length}건 ` +
      `(뗄 대상 ${toDetach.length}건 / 예산 보유로 건드리지 않음 ${budgetSkipped.length}건)`,
  );
  for (const p of toDetach) {
    const c = p.campaign;
    logger.info(
      `[detach-coupon-campaigns]   - ${p.code} → campaign ${c?.campaign_identifier ?? p.campaign_id} ` +
        `(starts=${c?.starts_at ?? '-'}, ends=${c?.ends_at ?? '-'})`,
    );
  }
  for (const p of budgetSkipped) {
    const c = p.campaign;
    logger.info(
      `[detach-coupon-campaigns]   - [예산 보유 — 건드리지 않음] ${p.code} → campaign ` +
        `${c?.campaign_identifier ?? p.campaign_id} (starts=${c?.starts_at ?? '-'}, ends=${c?.ends_at ?? '-'}) — ` +
        `campaign_id·날짜 모두 유지. promotion_meta 가 이미 같은 값을 갖고 있어 두 축은 일치한다.`,
    );
  }

  // "이번에 떼지 않는 프로모션이 이 캠페인을 아직 참조하는가" — ①의 날짜 삭제 가드와 ③의 고아
  // 캠페인 삭제 판정이 묻는 완전히 같은 질문이라, 여기 한 번만 계산해 둘 다에 쓴다(F2 교훈:
  // 이 계산이 ③에서만 쓰이고 ①의 write 보다 뒤에 있으면, ①이 무가드로 먼저 캠페인 날짜를
  // 지워버려 이 계산 자체가 뒤늦은 사후 확인이 된다).
  //
  // 🔴 "이번에 뗀 프로모션이 물려 있던 캠페인" 만으로 세면 안 된다 — `campaign.promotions` 는
  // hasMany 라 메타 없는 다른 프로모션이 같은 캠페인에 *아직* 붙어 있을 수 있다.
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

  // toDetach 를 다시 가른다: 캠페인 날짜까지 지울 수 있는 것(아무도 안 남음) / campaign_id 만
  // 떼고 날짜는 유지해야 하는 것(다른 프로모션이 아직 참조 — 날짜가 그 프로모션의 유일한 만료).
  const dateSharedCampaigns = [
    ...new Map(
      toDetach
        .filter((p) => p.campaign?.id && remainingPromotionCountByCampaignId.has(p.campaign.id))
        .map((p) => [p.campaign.id, p.campaign]),
    ).values(),
  ];
  logger.info(
    `[detach-coupon-campaigns] 캠페인 날짜를 지울 프로모션: ${
      toDetach.filter((p) => p.campaign?.id && !remainingPromotionCountByCampaignId.has(p.campaign.id)).length
    }건, 다른 프로모션이 아직 참조해 날짜를 유지하는 캠페인: ${dateSharedCampaigns.length}건`,
  );
  for (const c of dateSharedCampaigns) {
    logger.info(
      `[detach-coupon-campaigns]   - [공유 캠페인 — 날짜 유지] ${c.campaign_identifier ?? c.id} — ` +
        `이번에 떼지 않는 다른 프로모션 ${remainingPromotionCountByCampaignId.get(c.id)}건이 아직 참조한다. ` +
        `campaign_id 는 (이번 대상 프로모션에서만) 그대로 뗀다.`,
    );
  }

  if (!dryRun) {
    for (const p of toDetach) {
      // campaign 조인이 비어 있으면(소프트 삭제 등 이례적 상황) 캠페인 자체를 갱신할 대상이
      // 없다. 다른 프로모션이 아직 참조 중이어도 날짜는 지우지 않는다(F2). 둘 다
      // 이 프로모션의 campaign_id 를 떼는 것(②)까지 막을 이유는 아니므로 updatePromotions
      // 는 조건 없이 돈다.
      if (p.campaign?.id && !remainingPromotionCountByCampaignId.has(p.campaign.id)) {
        await promotionModule.updateCampaigns([{ id: p.campaign.id, starts_at: null, ends_at: null }]);
      }
      await promotionModule.updatePromotions([{ id: p.id, campaign_id: null }]);
    }
  }

  // ── ③ 고아가 된 기계 생성 캠페인 삭제 (예산 있는 것 / 다른 프로모션이 남은 것은 건드리지 않는다) ──
  const detachedCampaigns = [
    ...new Map(toDetach.filter((p) => p.campaign?.id).map((p) => [p.campaign.id, p.campaign])).values(),
  ];
  // `!c.budget?.id` 는 이제 항상 참이다 — toDetach 자체가 예산 있는 캠페인을 이미 걸러냈다
  // (위 budgetSkipped). 그래도 "예산 없음이 삭제의 전제"라는 불변식을 여기서도 명시적으로
  // 지키도록 남겨둔다 — toDetach 필터가 나중에 느슨해져도 이 줄이 방어선이 된다.
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
  // "채울 수 없는" 쪽 — 정책에도 ends_at 이 없어 이번에도 무기한으로 남는 링크. 카운트 차이로만
  // 보이면 이 행들이 그대로 사라지므로(가장 위험한 부분), 따로 뽑아 이름을 붙여 로그로 남긴다.
  // (`backfillable[i].l` 은 `needBackfill` 원소를 그대로 참조하므로 Set 은 참조 동등성으로 걸러진다.)
  const backfillableLinks = new Set(backfillable.map((x) => x.l));
  const stillUnlimited = needBackfill.filter((l) => !backfillableLinks.has(l));
  logger.info(
    `[detach-coupon-campaigns] expires_at 이 빈 링크 ${needBackfill.length}건 중 ` +
      `정책값으로 채울 수 있는 것 ${backfillable.length}건, 정책도 무기한이라 그대로 남는 것 ${stillUnlimited.length}건`,
  );

  // ①②③은 행마다 상세를 찍는데 여기만 집계 두 개만 찍으면, 운영자가 CONFIRM 을 켜기 전에
  // 무엇이 바뀌는지도 무엇이 안 바뀌는지도 못 본다. 특히 "그대로 남는" 쪽은 이 스크립트 이후에도
  // 영원히 무기한인 쿠폰이라 — 두 카운트의 차이로만 존재를 암시하지 않고 행 단위로 보여준다.
  // 행이 아주 많을 수 있으니 상한을 두고 초과분은 건수만 알린다.
  const LOG_ROW_LIMIT = 20;
  const logRows = (rows: string[]) => {
    for (const row of rows.slice(0, LOG_ROW_LIMIT)) {
      logger.info(`[detach-coupon-campaigns]   - ${row}`);
    }
    if (rows.length > LOG_ROW_LIMIT) {
      logger.info(`[detach-coupon-campaigns]   ...그 외 ${rows.length - LOG_ROW_LIMIT}건 더 (상한 ${LOG_ROW_LIMIT}줄)`);
    }
  };
  logRows(
    backfillable.map(({ l, endsAt }) => {
      const code = promotionCodeById.get(l.promotion_id) ?? '-';
      return (
        `[백필] customer=${l.customer_id} promotion=${l.promotion_id}(${code}) ` +
        `→ expires_at=${new Date(endsAt).toISOString()}`
      );
    }),
  );
  logRows(
    stillUnlimited.map((l) => {
      const code = promotionCodeById.get(l.promotion_id) ?? '-';
      return (
        `[무기한 유지] customer=${l.customer_id} promotion=${l.promotion_id}(${code}) ` +
        `— 정책 ends_at 없음, 이 쿠폰은 계속 무기한이다`
      );
    }),
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
