import { ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { type SubscriberConfig, type SubscriberArgs } from '@medusajs/medusa';
import { recordAutoIssueFailure, recordAutoIssueOutcome } from '../observability/coupon-issue.metrics';
import { autoIssueCoupons, isAutoIssueEnabled } from '../workflows/coupons/auto-issue-coupons';

const TRIGGER = 'customer_registered' as const;

/**
 * 회원가입 자동발급의 입구 (#775, ADR-0035).
 *
 * 옛 입구는 user-service 의 Kafka `UserEmailVerified` 였는데 발행 코드가 도달 불가라(가입이 사용자를 이미
 * 인증된 상태로 넣는다) 한 번도 발화하지 못했다. 여기는 Medusa 코어가 고객 생성 워크플로 끝에 네이티브로
 * 내는 `customer.created` 를 듣는다 — 우리 가입 경로(`workflows/auth/.../register-customer-workflow.ts`)가
 * 그 워크플로를 지나므로 이벤트가 실제로 뜨고, **고객이 정의상 존재**해 「Medusa 고객 미존재 → 백오프」
 * 함정이 원인부터 사라진다.
 *
 * `has_account` 게이트: `customer.created` 는 어드민이 만든 고객(코어 `POST /admin/customers`, has_account=false)
 * 에도 뜬다. «회원가입» 은 인증 계정이 붙은 고객뿐이다. 게스트 결제 고객은 오늘은 이벤트 없이 생기지만
 * 엔진이 바뀌어도 같은 게이트가 덮는다.
 *
 * 🔴 재시도가 없다. Redis 이벤트버스의 기본 attempts 는 1 이고 우리 설정은 안 바꿨다(스펙 결정 2 — 같은
 * 프로세스·같은 DB 라 남는 실패는 순단과 버그뿐). 그래서 실패는 **삼키되 보이게** 한다: 카운터
 * `coupon_auto_issue_failures_total{trigger="customer_registered",kind="permanent"}` + error 로그. 복구는
 * 사람이 아래 로그의 명령을 한 번 부른다 — 발급 키가 결정적이라 몇 번 불러도 한 장이다.
 */
export default async function handleCouponAutoIssueOnCustomerCreated({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  if (!isAutoIssueEnabled()) return;
  const customerId = data?.id;
  if (!customerId) return;

  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const repair = `POST /admin/customers/${customerId}/issue-coupons {"trigger":"${TRIGGER}"}`;

  try {
    const { data: customers } = await query.graph({
      entity: 'customer',
      fields: ['id', 'has_account'],
      filters: { id: customerId },
    });
    const customer = customers?.[0] as { id: string; has_account?: boolean | null } | undefined;
    if (!customer?.has_account) return;

    const outcome = await autoIssueCoupons(container, { customerId, trigger: TRIGGER });
    recordAutoIssueOutcome(TRIGGER, outcome);

    if (outcome.failed.length > 0) {
      recordAutoIssueFailure(TRIGGER);
      logger.error(
        `[coupon] 회원가입 자동발급 일부 실패 (customer_id=${customerId}, promotion_ids=${outcome.failed
          .map((f) => f.promotion_id)
          .join(',')}). 재시도 없음 — 수동 복구: ${repair}`,
      );
    }
    if (outcome.issued.length > 0) {
      logger.info(
        `[coupon] 회원가입 자동발급 ${outcome.issued.length}장 (customer_id=${customerId}, codes=${outcome.issued
          .map((i) => i.code)
          .join(',')})`,
      );
    }
  } catch (e: any) {
    recordAutoIssueFailure(TRIGGER);
    logger.error(
      `[coupon] 회원가입 자동발급 실패 (customer_id=${customerId}): ${e?.message ?? e}. 재시도 없음 — 수동 복구: ${repair}`,
    );
  }
}

export const config: SubscriberConfig = {
  event: 'customer.created',
  context: { subscriberId: 'coupon-auto-issue-customer-registered' },
};
