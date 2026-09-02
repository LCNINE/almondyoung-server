import { createWorkflow, WorkflowResponse, transform } from '@medusajs/framework/workflows-sdk';
import { createRemoteLinkStep } from '@medusajs/core-flows';
import { Modules } from '@medusajs/framework/utils';
import {
  issueCouponGrantsStep,
  type IssueCouponGrantsStepInput,
} from '../steps/issue-coupon-grants-step';

export type IssueCouponGrantWorkflowInput = IssueCouponGrantsStepInput;

/**
 * 쿠폰 한 장(또는 여러 장)을 발급하고 표시용 링크까지 세운다.
 *
 * **왜 워크플로인가.** 장은 우리 모듈(`promotion-meta`)에, 표시용 링크는 link 모듈에 있어
 * 한 트랜잭션에 못 넣는다. 그 틈이 실제 결함을 만들었다 — 옛 코드는 네 발급 경로가 각자
 * `link.create(...).catch(() => {})` 를 했고, 그중 둘은 실패를 통째로 삼켰다. 결과는
 * 「고객이 가지고 있고 코드를 치면 쓸 수 있는데 마이페이지에도 어드민에도 **안 보이는**」
 * 쿠폰이다. 셀프 클레임 경로에서는 재클릭이 「이미 보유」 빠른 경로로 200 을 돌려주는 탓에
 * 링크가 **영원히** 복구되지 않았다.
 *
 * 워크플로 안에서는 링크 실패가 곧 워크플로 실패고, 앞선 스텝이 보상돼 장까지 함께
 * 사라진다. 「장은 있는데 링크가 없다」는 상태가 **구조적으로 만들어지지 않는다** —
 * 삼키려면 워크플로를 우회해야 하고, 그건 리뷰에서 보인다 (ADR-0034 결정 2).
 *
 * `createRemoteLinkStep` 은 보상이 내장돼 있다(`link.dismiss(createdLinks)`) — 문서엔
 * 없고 소스에 있다. 여기서는 마지막 스텝이라 그 보상이 돌 일은 없지만, 뒤에 스텝을 더할
 * 때는 이미 안전하다.
 */
export const issueCouponGrantWorkflow = createWorkflow(
  'issue-coupon-grant',
  (input: IssueCouponGrantWorkflowInput) => {
    const result = issueCouponGrantsStep(input);

    // 🔴 장이 하나도 없으면 링크를 만들지 않는다. 전량 소진(`exhausted`)인데 링크만 세우면
    // 「장 없는 링크」가 남고, 그건 고객 화면에 못 쓰는 쿠폰으로 뜨면서 회수도 안 되던
    // 바로 그 유령이다. `duplicated` 만 있는 경우(같은 제출의 재도착)에는 **만든다** —
    // 직전 시도가 링크에서 실패했다면 이 자리가 복구 경로이고, `link.create` 는 upsert 라
    // 정상 재시도에서는 무해한 no-op 이다.
    const links = transform({ input, result }, (data) =>
      data.result.created.length + data.result.duplicated.length > 0
        ? [
            {
              [Modules.CUSTOMER]: { customer_id: data.input.customer_id },
              [Modules.PROMOTION]: { promotion_id: data.input.promotion_id },
            },
          ]
        : [],
    );

    createRemoteLinkStep(links);

    return new WorkflowResponse(result);
  },
);
