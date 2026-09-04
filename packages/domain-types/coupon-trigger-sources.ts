import type { AutoIssueTrigger } from './coupon-auto-issue-trigger';

/**
 * 트리거마다 «누가 발화시키는가» (#775, ADR-0035 가드 규칙).
 *
 * 2026-09-01 리허설에서 `customer_registered` 가 한 번도 발화할 수 없었다는 것이 드러났다 — 구독자는 있었고
 * 발행 코드도 있었는데 그 코드가 도달 불가였다. 각 층의 테스트는 전부 초록이었다. 이 표는 그 «층 사이» 를
 * 코드로 적은 것이고, `coupon-trigger-producers.spec.ts` 가 표의 각 줄이 실제 소스와 맞는지 대조한다.
 *
 * `Record<AutoIssueTrigger, …>` 라 어휘에 값을 더하고 여기를 안 채우면 루트 `type-check` 가 먼저 막는다.
 *
 * 한계: 「발행 코드가 존재한다」까지 본다. 존재하되 도달 불가한 것은 정적으로 못 잡는다 — 그것은 리허설의 몫이다.
 */
export type TriggerSource =
  | {
      kind: 'medusa_subscriber';
      /** 저장소 루트 기준 경로. */
      file: string;
      /** Medusa 코어 이벤트 이름. 코어가 emit 하는지는 가드 B(Medusa 유닛)가 본다. */
      event: string;
    }
  | {
      kind: 'kafka_inbox';
      /** `enqueue(`/`publishEvent(` 호출 안에 `eventType: '<eventType>'` 이 있어야 한다. */
      producerFile: string;
      eventType: string;
      /** `case '<eventType>'` 이 있어야 한다 (inbox 워커). */
      consumerFile: string;
      /** `issuePromotionsByTrigger(` 와 트리거 리터럴이 있어야 한다 (워커가 위임하는 서비스). */
      issuerFile: string;
    };

export const COUPON_TRIGGER_SOURCES: Record<AutoIssueTrigger, TriggerSource> = {
  customer_registered: {
    kind: 'medusa_subscriber',
    file: 'apps/medusa/src/subscribers/coupon-auto-issue-on-customer-created.ts',
    event: 'customer.created',
  },
  membership_activated: {
    kind: 'kafka_inbox',
    producerFile: 'apps/membership/src/services/membership-event.publisher.ts',
    eventType: 'MembershipStatusChanged',
    consumerFile: 'apps/channel-adapter/src/adapters/medusa/inbox-worker.service.ts',
    issuerFile: 'apps/channel-adapter/src/adapters/medusa/membership-medusa-sync.service.ts',
  },
};
