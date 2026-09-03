import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../modules/promotion-meta/service';
import type { IssueTrigger } from '../../../modules/promotion-meta/service';

export type IssueCouponGrantsStepInput = {
  promotion_id: string;
  customer_id: string;
  /** 발급할 장들의 멱등 키. 길이가 곧 요청 수량이다. */
  issue_keys: string[];
  issued_via: IssueTrigger;
  /**
   * 이 장의 만료. **ISO 문자열이다** — 워크플로 입력은 엔진을 거치며 직렬화될 수 있어
   * `Date` 를 그대로 실어 보내지 않는다. 스텝 안에서 되살린다.
   */
  expires_at: string | null;
  max_claims: number | null;
  enforce_cap: boolean;
};

export type IssueCouponGrantsStepResult = {
  /** 이번 실행이 «실제로 만든» 장의 issue_key 들. */
  created: string[];
  /** 같은 키가 이미 있어 건너뛴 것들. 재시도의 정상 결과다. */
  duplicated: string[];
  /** 상한에 걸려 중단됐는가. 일부만 만들어진 채 true 일 수 있다. */
  exhausted: boolean;
};

type CompensationData = {
  promotion_id: string;
  customer_id: string;
  issue_keys: string[];
} | null;

/**
 * 장을 발급한다. 슬롯 예약은 모듈의 트랜잭션 안에서 함께 일어난다 (ADR-0034 결정 1).
 *
 * 보상은 **이번 실행이 만든 장만** 되돌린다. `duplicated` 는 이전 제출이 만든 남의 것이라
 * 건드리면 안 된다 — 이미 잘 쓰고 있던 쿠폰을 (이유가 무엇이든) 회수해 버리는 것은 고치려는
 * 문제보다 나쁘다.
 *
 * Task 7 이전엔 이 워크플로에 표시용 링크 스텝이 뒤따라 있어, 그 링크 실패가 이 보상을 거는
 * 실제 트리거였다. 지금은 이 스텝이 워크플로의 전부라 이 보상을 걸 뒤 스텝이 없다 — 그래도
 * 남긴다: 재시도·향후 확장이 이 스텝을 다시 쓸 자리이고, 「이번 실행이 만든 것만 되돌린다」는
 * 그 자체로 지켜야 할 불변식이다.
 */
export const issueCouponGrantsStep = createStep(
  'issue-coupon-grants',
  async (input: IssueCouponGrantsStepInput, { container }) => {
    const service = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
    const now = new Date();
    const expiresAt = input.expires_at ? new Date(input.expires_at) : null;

    const created: string[] = [];
    const duplicated: string[] = [];
    let exhausted = false;

    for (const issueKey of input.issue_keys) {
      const result = await service.issueGrantWithSlot({
        promotion_id: input.promotion_id,
        customer_id: input.customer_id,
        issue_key: issueKey,
        issued_via: input.issued_via,
        expires_at: expiresAt,
        now,
        max_claims: input.max_claims,
        enforce_cap: input.enforce_cap,
      });

      if (result === 'created') {
        created.push(issueKey);
      } else if (result === 'duplicate') {
        duplicated.push(issueKey);
      } else {
        // 상한에 닿았다. 남은 수량은 시도하지 않는다 — 어차피 같은 답이다.
        exhausted = true;
        break;
      }
    }

    const compensation: CompensationData =
      created.length > 0
        ? {
            promotion_id: input.promotion_id,
            customer_id: input.customer_id,
            issue_keys: created,
          }
        : null;

    return new StepResponse<IssueCouponGrantsStepResult, CompensationData>(
      { created, duplicated, exhausted },
      compensation,
    );
  },
  async (compensation, { container }) => {
    if (!compensation) return;
    const service = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);

    // soft delete 가 곧 슬롯 반환이다 — `countIssuedGrants` 가 `deleted_at IS NULL` 인 장만
    // 세므로, 되돌린 장은 되돌리는 즉시 다음 발급 시도의 상한 계산에서 빠진다. 별도로
    // 슬롯을 반환하는 호출이 필요 없다(옛 `releaseClaimSlot` 루프가 하던 일).
    await service.revokeGrantsByIssueKeys(
      compensation.promotion_id,
      compensation.customer_id,
      compensation.issue_keys,
    );
  },
);
