import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import type { ExecArgs, IPricingModuleService } from '@medusajs/framework/types';

/** 고객 그룹으로 가격을 가르는 price list 룰의 attribute. */
const CUSTOMER_GROUP_ATTRIBUTE = 'customer.groups.id';

export type PriceListGuardViolation = {
  priceListId: string;
  title?: string;
  groupIds: string[];
};

const toGroupIds = (value: string | string[]): string[] => {
  if (Array.isArray(value)) return value;
  // 값이 JSON 배열 문자열로 올라오는 경로가 있어 둘 다 받는다.
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    /* 평문 단일 값 */
  }
  return [value];
};

/**
 * "고객 그룹 룰이 걸린 price list 는 멤버십 하나뿐" 이라는 전제를 검증한다.
 *
 * 카탈로그 캐시는 응답이 회원/비회원 두 벌로 전부 표현된다는 전제 위에 서 있다. 그런데 그
 * 전제는 지금까지 주석에만 있었다. 누가 어드민에서 "VIP 전용 할인" price list 를 하나
 * 만드는 순간, 코드는 그대로인데 두 벌로는 표현이 안 되는 상태가 되고 VIP 는 자기 가격 대신
 * 남의 캐시를 보게 된다. 코드로 막을 수 없는 종류라 주기 점검으로 잡는다.
 */
export const findPriceListGuardViolations = async (
  pricingModule: IPricingModuleService,
  membershipGroupId: string,
): Promise<PriceListGuardViolation[]> => {
  const priceLists = await pricingModule.listPriceLists({}, { relations: ['price_list_rules'] });

  const violations: PriceListGuardViolation[] = [];

  for (const priceList of priceLists) {
    const groupIds = (priceList.price_list_rules ?? [])
      .filter((rule) => rule.attribute === CUSTOMER_GROUP_ATTRIBUTE)
      .flatMap((rule) => toGroupIds(rule.value));

    if (groupIds.length === 0) continue;

    const unexpected = groupIds.filter((id) => id !== membershipGroupId);
    if (unexpected.length > 0) {
      violations.push({
        priceListId: priceList.id,
        title: priceList.title,
        groupIds: unexpected,
      });
    }
  }

  return violations;
};

export type DirectPriceRuleViolation = {
  groupId: string;
  ruleCount: number;
};

type KnexLike = {
  raw(sql: string, bindings: string[]): Promise<{ rows?: Array<{ group_id: string; rule_count: string | number }> }>;
};

/**
 * price list 를 안 거치는 두 번째 경로도 본다: price 에 직접 단 `customer.groups.id` rule.
 *
 * pricing 모듈은 price list rule 과 별개로 price 자체의 rule(`price_rule`)도 컨텍스트와
 * 대조하므로(`@medusajs/pricing` repositories/pricing.js 의 pr_stats LATERAL join),
 * 여기로도 그룹별 가격이 갈린다. pricing 모듈 API 의 rule 필터엔 attribute 가 없어
 * 테이블을 직접 읽는다.
 */
export const findDirectPriceRuleViolations = async (
  knex: KnexLike,
  membershipGroupId: string,
): Promise<DirectPriceRuleViolation[]> => {
  const result = await knex.raw(
    `SELECT pr.value AS group_id, COUNT(*) AS rule_count
       FROM price_rule pr
      WHERE pr.attribute = ?
        AND pr.deleted_at IS NULL
        AND pr.value <> ?
      GROUP BY pr.value`,
    [CUSTOMER_GROUP_ATTRIBUTE, membershipGroupId],
  );

  return (result.rows ?? []).map((row) => ({
    groupId: row.group_id,
    ruleCount: Number(row.rule_count),
  }));
};

export default async function catalogPriceListGuard({ container }: ExecArgs) {
  const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID?.trim();

  if (!membershipGroupId) {
    console.error('[catalog-price-list-guard] MEDUSA_MEMBERSHIP_GROUP_ID 가 비어 점검할 수 없다.');
    return;
  }

  const pricingModule = container.resolve<IPricingModuleService>(Modules.PRICING);
  const knex = container.resolve<KnexLike>(ContainerRegistrationKeys.PG_CONNECTION);

  const violations = await findPriceListGuardViolations(pricingModule, membershipGroupId);
  const directViolations = await findDirectPriceRuleViolations(knex, membershipGroupId);

  if (violations.length === 0 && directViolations.length === 0) {
    console.log('[catalog-price-list-guard] 고객 그룹으로 가격을 가르는 건 멤버십뿐이다.');
    return;
  }

  if (violations.length > 0) {
    console.error(
      `[catalog-price-list-guard] 멤버십 외 고객 그룹 룰이 걸린 price list ${violations.length}건 — ` +
        '카탈로그 캐시가 회원/비회원 두 벌 전제로 서 있어 해당 그룹은 잘못된 가격을 볼 수 있다.',
      violations,
    );
  }

  if (directViolations.length > 0) {
    console.error(
      `[catalog-price-list-guard] price list 없이 고객 그룹 룰이 직접 걸린 가격 ${directViolations.length}개 그룹 — ` +
        '같은 이유로 해당 그룹은 잘못된 가격을 볼 수 있다.',
      directViolations,
    );
  }
}
