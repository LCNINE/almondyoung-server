import { Injectable, Logger } from '@nestjs/common';
import type { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';
import { MedusaClient } from './medusa.client';
import { EventTrackingService } from '@app/events';
import type { SyncResult } from '../../types';

@Injectable()
export class MembershipMedusaSyncService {
  private readonly logger = new Logger(MembershipMedusaSyncService.name);

  constructor(
    private readonly medusaClient: MedusaClient,
    private readonly eventTrackingService: EventTrackingService,
  ) {}

  /**
   * Handle MembershipStatusChanged event
   *
   * Medusa 고객 그룹(멤버십) 동기화
   */
  async handleMembershipStatusChanged(event: MembershipStatusChangedPayload): Promise<SyncResult> {
    const { userId, email, status } = event;
    const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID;

    if (!membershipGroupId) {
      this.logger.warn('MEDUSA_MEMBERSHIP_GROUP_ID is not set. Skipping sync.');
      return { success: false, data: { userId, action: 'skipped' } };
    }

    if (!email) {
      this.logger.warn(`Missing email for membership sync: ${userId}`);
      await this.eventTrackingService
        .trackEffect({
          resourceType: 'UserMembership',
          resourceId: userId,
          action: 'SKIPPED',
          description: `이메일 없음 (userId=${userId})`,
          eventType: 'MembershipStatusChanged',
        })
        .catch((e) => this.logger.warn(`trackEffect 실패: ${e?.message}`));
      return { success: false, data: { userId, action: 'skipped' } };
    }

    try {
      const customer = await this.medusaClient.findCustomerByAlmondUserId(userId);
      if (!customer) {
        this.logger.warn(`Medusa customer not found for email=${email} (userId=${userId})`);
        await this.eventTrackingService
          .trackEffect({
            resourceType: 'UserMembership',
            resourceId: userId,
            action: 'SKIPPED',
            description: `Medusa 고객 없음 (email=${email}, userId=${userId})`,
            eventType: 'MembershipStatusChanged',
          })
          .catch((e) => this.logger.warn(`trackEffect 실패: ${e?.message}`));
        return { success: false, data: { userId, action: 'skipped' } };
      }

      const addStatuses = new Set(['ACTIVE', 'RESUMED']);
      const removeStatuses = new Set(['PAUSED', 'CANCELLED', 'EXPIRED']);

      if (addStatuses.has(status)) {
        await this.medusaClient.addCustomerToGroup(customer.id, membershipGroupId);
        await this.eventTrackingService
          .trackEffect({
            resourceType: 'MedusaCustomer',
            resourceId: customer.id,
            action: 'SYNCED',
            description: `멤버십 그룹 추가 (userId=${userId}, status=${status})`,
            eventType: 'MembershipStatusChanged',
          })
          .catch((e) => this.logger.warn(`trackEffect 실패: ${e?.message}`));
        return { success: true, data: { userId, action: 'synced' } };
      }

      if (removeStatuses.has(status)) {
        await this.medusaClient.removeCustomerFromGroup(customer.id, membershipGroupId);
        await this.eventTrackingService
          .trackEffect({
            resourceType: 'MedusaCustomer',
            resourceId: customer.id,
            action: 'SYNCED',
            description: `멤버십 그룹 제거 (userId=${userId}, status=${status})`,
            eventType: 'MembershipStatusChanged',
          })
          .catch((e) => this.logger.warn(`trackEffect 실패: ${e?.message}`));
        return { success: true, data: { userId, action: 'synced' } };
      }

      // RECURRING_CANCELLED 등: 그룹 유지 (noop)
      this.logger.log(`Membership status ${status} is a no-op for group sync (userId=${userId})`);
      await this.eventTrackingService
        .trackEffect({
          resourceType: 'UserMembership',
          resourceId: userId,
          action: 'SKIPPED',
          description: `멤버십 상태 ${status}는 그룹 동기화 대상 아님 (userId=${userId})`,
          eventType: 'MembershipStatusChanged',
        })
        .catch((e) => this.logger.warn(`trackEffect 실패: ${e?.message}`));
      return { success: true, data: { userId, action: 'skipped' } };
    } catch (error) {
      this.logger.error(`Failed to sync membership group for userId=${userId}`, error.stack);
      return { success: false, data: { userId, action: 'failed' } };
    }
  }
}
