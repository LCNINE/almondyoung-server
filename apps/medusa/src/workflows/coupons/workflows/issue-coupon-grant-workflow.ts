import { createWorkflow, WorkflowResponse } from '@medusajs/framework/workflows-sdk';
import {
  issueCouponGrantsStep,
  type IssueCouponGrantsStepInput,
} from '../steps/issue-coupon-grants-step';

export type IssueCouponGrantWorkflowInput = IssueCouponGrantsStepInput;

/**
 * 쿠폰 한 장(또는 여러 장)을 발급한다.
 *
 * **왜 링크 스텝이 없는가 (Task 7, ADR-0034 결정 2 완료).** 이 워크플로는 한때 표시용
 * customer↔promotion 링크도 같이 세웠다. 장은 `promotion-meta` 모듈에, 링크는 link
 * 모듈에 있어 한 트랜잭션에 못 넣으니, 그 둘을 한 워크플로로 묶어 링크 실패가 곧 워크플로
 * 실패가 되게 하고 앞선 스텝(발급)까지 보상으로 되감았다 — 「고객이 가지고 있고 코드를 치면
 * 쓸 수 있는데 마이페이지에도 어드민에도 **안 보이는**」 유령을 막으려는 장치였다.
 *
 * 그런데 그 유령을 막을 이유 자체가 사라졌다. 앞선 태스크들이 「이 고객이 가진 쿠폰」의
 * 정본을 `coupon_grant` 하나로 좁혔고, 그걸 읽던 자리(마이페이지·어드민·카트 게이트 전부)를
 * grant 조회로 옮겼다 — 지금 이 저장소에 링크를 **읽는** 코드는 한 줄도 없다. 아무도 안
 * 읽는 링크가 보이니 안 보이니를 걱정할 이유가 없어져서 이 스텝을 걷어낸다. 링크 테이블
 * 자체와 `src/links/customer-promotion.ts` 의 `defineLink` 정의는 남아 있다(스키마
 * 변경 없음, 후속 PR 에서 정리) — 이 태스크는 «코드가 링크를 쓰는 것»만 멈춘다.
 *
 * **부수 효과.** 링크 스텝이 있을 때는 실패가 곧 워크플로 실패였다. 이제 워크플로는
 * `issueCouponGrantsStep` 하나뿐이라, 여러 장(`issue_keys` 여러 개)을 발급하는 도중 상한에
 * 걸려 중단되면 그건 «부패»가 아니라 **부분 성공**이다 — 이미 만든 장은 그대로 유효하고,
 * 상한 집행·표시(발급 현황·마이페이지)도 그 장들을 정직하게 반영한다. 스텝의 보상
 * (`revokeGrantsByIssueKeys`)은 여전히 있지만 더는 정합성의 유일한 방어선이 아니다 — 실패한
 * 나머지를 되돌려 주면 좋지만, 안 돼도 「장은 있는데 안 보인다」류의 유령이 생기진 않는다.
 */
export const issueCouponGrantWorkflow = createWorkflow(
  'issue-coupon-grant',
  (input: IssueCouponGrantWorkflowInput) => {
    const result = issueCouponGrantsStep(input);
    return new WorkflowResponse(result);
  },
);
