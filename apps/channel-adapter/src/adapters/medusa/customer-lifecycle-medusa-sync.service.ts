import { Injectable, Logger } from '@nestjs/common';
import { EventTrackingService } from '@app/events';
import type { UserDeletedPayload, UserUpdatedPayload } from '@packages/event-contracts/streams/user.stream';
import { MedusaClient } from './medusa.client';
import type { SyncResult } from '../../types';

/** `UserUpdated` 는 email 이 optional 이다. 소비자가 email 있는 것만 inbox 에 넣으므로 여기선 필수다. */
export type UserEmailChangedPayload = Pick<UserUpdatedPayload, 'userId'> & { email: string };

/**
 * user-service 회원 생애주기(이메일 변경·탈퇴)를 Medusa 고객에 반영한다 (#786, 스펙 §4.2).
 *
 * `MembershipMedusaSyncService` 와 같은 자리다 — inbox 워커가 부르고, Medusa 호출 실패는 던져서 inbox 가
 * 재시도·failed 를 판단하게 한다. **어느 경로도 `SlowRetryInboxError` 를 던지지 않는다.** 그 에러는 「선행
 * 조건이 나중에 충족된다」는 뜻인데, 탈퇴자는 앞으로 로그인하지 않고 이메일 변경자는 첫 로그인 때 현재
 * 이메일로 생성된다. 기다릴 것이 없다.
 */
@Injectable()
export class CustomerLifecycleMedusaSyncService {
  private readonly logger = new Logger(CustomerLifecycleMedusaSyncService.name);

  constructor(
    private readonly medusaClient: MedusaClient,
    private readonly eventTrackingService: EventTrackingService,
  ) {}

  async handleUserUpdated(payload: UserEmailChangedPayload): Promise<SyncResult> {
    const { userId, email } = payload;
    const customer = await this.medusaClient.findCustomerByAlmondUserId(userId);

    if (!customer) {
      this.logger.log(`UserUpdated(email): Medusa 고객 없음 — 첫 로그인 때 현재 이메일로 생성된다 (userId=${userId})`);
      await this.track({
        resourceType: 'UserAccount',
        resourceId: userId,
        action: 'SKIPPED',
        description: 'Medusa 고객 없음 — 첫 로그인 때 현재 이메일로 생성',
        eventType: 'UserUpdated',
      });
      return { success: true, data: { userId, action: 'skipped' } };
    }

    if (customer.email === email) {
      return { success: true, data: { userId, action: 'skipped' } };
    }

    await this.medusaClient.updateCustomerEmail(customer.id, email);
    this.logger.log(`Customer email synced: customerId=${customer.id}, userId=${userId}`);
    await this.track({
      resourceType: 'MedusaCustomer',
      resourceId: customer.id,
      action: 'SYNCED',
      description: `이메일 동기화 (userId=${userId})`,
      eventType: 'UserUpdated',
    });
    return { success: true, data: { userId, action: 'synced' } };
  }

  async handleUserDeleted(payload: UserDeletedPayload): Promise<SyncResult> {
    const { userId } = payload;
    const outcome = await this.medusaClient.withdrawCustomer(userId);
    const anonymized = outcome.customer === 'anonymized';

    await this.track({
      resourceType: 'UserAccount',
      resourceId: userId,
      action: anonymized ? 'SYNCED' : 'SKIPPED',
      description: `탈퇴 파기 customer=${outcome.customer} auth_identities_deleted=${outcome.auth_identities_deleted}`,
      eventType: 'UserDeleted',
    });
    return { success: true, data: { userId, action: anonymized ? 'synced' : 'skipped' } };
  }

  /** effect 기록은 관측이지 결과가 아니다 — 실패해도 동기화 결과를 바꾸지 않는다 (형제 서비스와 같은 규칙). */
  private async track(params: Parameters<EventTrackingService['trackEffect']>[0]): Promise<void> {
    await this.eventTrackingService.trackEffect(params).catch((e) => this.logger.warn(`trackEffect 실패: ${e?.message}`));
  }
}
