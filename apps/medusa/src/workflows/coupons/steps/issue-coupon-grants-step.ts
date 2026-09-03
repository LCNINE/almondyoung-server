import { createStep, StepResponse } from '@medusajs/framework/workflows-sdk';
import { PROMOTION_META_MODULE } from '../../../modules/promotion-meta';
import type PromotionMetaModuleService from '../../../modules/promotion-meta/service';
import type { IssueTrigger } from '../../../modules/promotion-meta/service';
import { verdictOf, type IssueGrantVerdict } from './issue-grant-verdict';

export type { IssueGrantVerdict };

/** 발급 요청 하나 — (프로모션, 고객) 쌍에 장 N개. */
export type IssueGrantRequest = {
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

export type IssueGrantResult = {
  promotion_id: string;
  customer_id: string;
  verdict: IssueGrantVerdict;
  /** 이번 실행이 «실제로 만든» 장수. */
  created: number;
  /** 같은 키가 이미 있어 건너뛴 장수. 재시도의 정상 결과다. */
  duplicated: number;
  /** `verdict === 'error'` 일 때만. 라우트가 로그에 싣는다. */
  error?: string;
};

export type IssueCouponGrantsStepInput = { requests: IssueGrantRequest[] };
/** 입력과 같은 순서·길이. 라우트는 인덱스로 짝짓지 않고 (promotion_id, customer_id) 로 읽는다. */
export type IssueCouponGrantsStepResult = { results: IssueGrantResult[] };

type CompensationData = { promotion_id: string; customer_id: string; issue_keys: string[] }[] | null;

/**
 * 요청 배치를 발급한다. 슬롯 예약은 모듈의 트랜잭션 안에서 함께 일어난다 (ADR-0034 결정 1).
 *
 * **왜 배치인가 (PR-2 결정 3).** 옛 스텝은 (프로모션, 고객) 쌍 하나를 받았고 라우트가 고객마다·
 * 프로모션마다 `.run()` 을 돌렸다 — 대량발급 500명이면 Redis 워크플로 엔진 왕복 500회다. 문서는
 * 커스텀 플로를 워크플로에 두라 하므로 워크플로를 걷는 것이 아니라 입력을 배치로 만든다.
 *
 * **요청 하나의 예외는 그 요청의 `error` 로 격리한다.** 스텝이 던지면 배치 전체가 실패하고 보상이
 * 이번 실행의 «성공한» 장까지 걷어간다 — 라우트 셋이 지키던 「한 고객의 장애가 나머지를 막지
 * 않는다」가 깨진다. 던진 요청이 이미 만든 장은 그 자리에서 되돌린다(옛 단건 워크플로에서
 * 보상이 하던 일).
 *
 * 보상은 **이번 실행이 만든 장만** 되돌린다. `duplicated` 는 이전 제출이 만든 남의 것이라
 * 건드리면 안 된다. 스텝이 던지지 않으므로 사실상 잠든 안전망이지만, 「이번 실행이 만든 것만
 * 되돌린다」는 그 자체로 지켜야 할 불변식이라 남긴다(정본 1벌화 설계 §3 결정 2).
 */
export const issueCouponGrantsStep = createStep(
  'issue-coupon-grants',
  async (input: IssueCouponGrantsStepInput, { container }) => {
    const service = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
    const now = new Date();

    const results: IssueGrantResult[] = [];
    const compensation: NonNullable<CompensationData> = [];

    for (const req of input.requests) {
      const expiresAt = req.expires_at ? new Date(req.expires_at) : null;
      const created: string[] = [];
      let duplicated = 0;
      let exhausted = false;

      try {
        for (const issueKey of req.issue_keys) {
          const result = await service.issueGrantWithSlot({
            promotion_id: req.promotion_id,
            customer_id: req.customer_id,
            issue_key: issueKey,
            issued_via: req.issued_via,
            expires_at: expiresAt,
            now,
            max_claims: req.max_claims,
            enforce_cap: req.enforce_cap,
          });
          if (result === 'created') {
            created.push(issueKey);
          } else if (result === 'duplicate') {
            duplicated += 1;
          } else {
            // 상한에 닿았다. 남은 수량은 시도하지 않는다 — 어차피 같은 답이다.
            exhausted = true;
            break;
          }
        }
      } catch (e: any) {
        let error = String(e?.message ?? e);
        if (created.length > 0) {
          // 옛 단건 워크플로에선 보상이 하던 일 — 던진 요청이 이미 만든 장은 되돌린다.
          try {
            await service.revokeGrantsByIssueKeys(req.promotion_id, req.customer_id, created);
          } catch (e2: any) {
            error += ` (되감기 실패: ${String(e2?.message ?? e2)})`;
            // 제자리 되감기가 실패했으면 보상이 다시 걷게 등록한다 (회수는 멱등이라 겹쳐도 안전).
            compensation.push({ promotion_id: req.promotion_id, customer_id: req.customer_id, issue_keys: created });
          }
        }
        results.push({
          promotion_id: req.promotion_id,
          customer_id: req.customer_id,
          verdict: 'error',
          created: 0,
          duplicated,
          error,
        });
        continue;
      }

      if (created.length > 0) {
        compensation.push({ promotion_id: req.promotion_id, customer_id: req.customer_id, issue_keys: created });
      }
      results.push({
        promotion_id: req.promotion_id,
        customer_id: req.customer_id,
        verdict: verdictOf(created.length, exhausted),
        created: created.length,
        duplicated,
      });
    }

    return new StepResponse<IssueCouponGrantsStepResult, CompensationData>(
      { results },
      compensation.length > 0 ? compensation : null,
    );
  },
  async (compensation, { container }) => {
    if (!compensation) return;
    const service = container.resolve<PromotionMetaModuleService>(PROMOTION_META_MODULE);
    // soft delete 가 곧 슬롯 반환이다 — `countIssuedGrants` 가 `deleted_at IS NULL` 인 장만 세고,
    // 카운터 미러도 같은 트랜잭션에서 따라간다(0단계). 쓴 장은 건드리지 않는다(revokeGrants_ 본체).
    for (const c of compensation) {
      await service.revokeGrantsByIssueKeys(c.promotion_id, c.customer_id, c.issue_keys);
    }
  },
);
