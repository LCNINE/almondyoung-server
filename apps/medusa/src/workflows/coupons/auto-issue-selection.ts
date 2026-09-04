import { resolveVisibility } from '../../api/admin/promotions/helpers';
import { evaluateIssuanceRules, type PromotionRuleLike } from '../../modules/promotion-meta/issuance-rules';
import type { AutoIssueTrigger } from '../../modules/promotion-meta/service';
import { computeExpiresAt, issuanceWindowState, type ValidityPolicy } from '../../modules/promotion-meta/validity';
import type { IssueGrantRequest, IssueGrantResult } from './steps/issue-coupon-grants-step';

/**
 * 자동발급 한 번의 «판정» — I/O 없는 순수 함수 (#775, 스펙 §4.2.1).
 *
 * 옛날엔 이 루프가 `api/admin/customers/[id]/issue-coupons/route.ts` 안에 인라인이었다. 진입점이
 * 둘(channel-adapter 가 부르는 라우트 · Medusa `customer.created` subscriber)이 되면서 뽑았다.
 * 게이트 순서는 라우트 시절 그대로다: public → 발급창 → 룰. 각 단계의 사유 어휘도 그대로다 —
 * channel-adapter 의 `coupon-issue.metrics.ts` 가 `skipped.reason` 을 라벨로 세므로 이 유니온은
 * 그쪽 계약이다.
 */
export type AutoIssueSkipReason =
  | 'public_promotion'
  | 'not_started'
  | 'expired'
  | 'group_mismatch'
  | 'unsupported_rule'
  | 'already_issued'
  | 'max_claims_exceeded';

/** `promotion_meta` 행 중 판정이 읽는 것. 숫자 컬럼이 문자열로 오는 경우가 있어 `max_claims` 는 union. */
export type AutoIssueMeta = ValidityPolicy & {
  promotion_id: string;
  max_claims?: number | string | null;
  visibility?: string | null;
};

export type AutoIssuePromotion = {
  id: string;
  code: string;
  rules?: readonly PromotionRuleLike[] | null;
};

export type AutoIssueSelection = {
  /** 게이트를 넘은 것. 워크플로를 **한 번** 지난다. */
  requests: IssueGrantRequest[];
  skipped: { promotion_id: string; reason: AutoIssueSkipReason }[];
  codeById: Map<string, string>;
  /** fail-closed 로 떨어진 룰의 좌표. 호출자가 warn 로그로 남긴다 — 로그를 안 보면 아무도 모른다. */
  unsupportedRules: { promotion_id: string; attribute: string; operator: string }[];
};

export type AutoIssueSelectionInput = {
  trigger: AutoIssueTrigger;
  customerId: string;
  customerGroupIds: ReadonlySet<string>;
  metas: readonly AutoIssueMeta[];
  promotions: readonly AutoIssuePromotion[];
  now: Date;
};

export function selectAutoIssueCandidates(input: AutoIssueSelectionInput): AutoIssueSelection {
  const { trigger, customerId, customerGroupIds, metas, promotions, now } = input;
  const metaById = new Map(metas.map((m) => [m.promotion_id, m]));

  const requests: IssueGrantRequest[] = [];
  const skipped: AutoIssueSelection['skipped'] = [];
  const codeById = new Map<string, string>();
  const unsupportedRules: AutoIssueSelection['unsupportedRules'] = [];

  for (const promo of promotions) {
    const meta = metaById.get(promo.id);
    if (!meta) continue;

    // 🔴 `public` 쿠폰에 트리거를 걸어두면 가입자 전원에게 장이 한 장씩 생기고, 카트 게이트가
    // 「장이 있으면 장이 정한다」로 갈리는 탓에 **그 전원이** 1회 제한에 걸린다 (#488 A2).
    if (resolveVisibility(meta) === 'public') {
      skipped.push({ promotion_id: promo.id, reason: 'public_promotion' });
      continue;
    }

    // 발급 창은 캠페인이 아니라 promotion_meta 가 정한다 (#488 결정 1).
    const window = issuanceWindowState(meta, now);
    if (window !== 'ok') {
      skipped.push({ promotion_id: promo.id, reason: window === 'not_started' ? 'not_started' : 'expired' });
      continue;
    }

    // 분류표 밖 룰은 fail-closed (#488 1-5). 근거는 issuance-rules.ts 헤더 주석.
    const eligibility = evaluateIssuanceRules(promo.rules, customerGroupIds);
    if (!eligibility.eligible) {
      if (eligibility.reason === 'unsupported_rule') {
        unsupportedRules.push({
          promotion_id: promo.id,
          attribute: eligibility.attribute,
          operator: eligibility.operator,
        });
      }
      skipped.push({ promotion_id: promo.id, reason: eligibility.reason });
      continue;
    }

    codeById.set(promo.id, promo.code);
    requests.push({
      promotion_id: promo.id,
      customer_id: customerId,
      // 트리거당 한 장. 결정적 키라 어느 진입점에서 몇 번 불려도 멱등하다 — 멤버십을 가입·해지
      // 반복해도 같은 쿠폰이 두 번 안 나가는 이유가 이 키와 `idx_coupon_grant_issue_key` 다.
      issue_keys: [`trigger:${trigger}`],
      issued_via: trigger,
      expires_at: computeExpiresAt(meta, now)?.toISOString() ?? null,
      max_claims: meta.max_claims != null ? Number(meta.max_claims) : null,
      enforce_cap: true,
    });
  }

  return { requests, skipped, codeById, unsupportedRules };
}

export type AutoIssueOutcome = {
  issued: { promotion_id: string; code: string }[];
  skipped: { promotion_id: string; reason: AutoIssueSkipReason }[];
  /** 워크플로가 `error` verdict 를 돌려준 것. 라우트는 500 으로, subscriber 는 카운터로 올린다. */
  failed: { promotion_id: string; error: string }[];
};

/** 워크플로 verdict 를 응답 모양으로 접는다. 어휘가 늘면 `never` 분기가 컴파일을 막는다. */
export function foldGrantResults(
  results: readonly IssueGrantResult[],
  codeById: ReadonlyMap<string, string>,
): AutoIssueOutcome {
  const out: AutoIssueOutcome = { issued: [], skipped: [], failed: [] };
  for (const r of results) {
    switch (r.verdict) {
      case 'already_issued':
        out.skipped.push({ promotion_id: r.promotion_id, reason: 'already_issued' });
        break;
      case 'exhausted':
        out.skipped.push({ promotion_id: r.promotion_id, reason: 'max_claims_exceeded' });
        break;
      case 'issued':
      case 'partial': // 키가 하나라 partial 은 나올 수 없지만, 어휘가 닫혀 있으니 같은 칸에 둔다
        out.issued.push({ promotion_id: r.promotion_id, code: codeById.get(r.promotion_id) ?? '' });
        break;
      case 'error':
        out.failed.push({ promotion_id: r.promotion_id, error: r.error ?? 'unknown' });
        break;
      default: {
        const exhaustive: never = r.verdict;
        throw new Error(`알 수 없는 발급 결과: ${String(exhaustive)}`);
      }
    }
  }
  return out;
}
