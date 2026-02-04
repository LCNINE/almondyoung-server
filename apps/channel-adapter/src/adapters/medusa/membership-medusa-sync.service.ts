import { Injectable, Logger } from '@nestjs/common';
import type { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';
import { MedusaClient } from './medusa.client';
import type { SyncResult } from '../../types';

@Injectable()
export class MembershipMedusaSyncService {
  private readonly logger = new Logger(MembershipMedusaSyncService.name);

  constructor(private readonly medusaClient: MedusaClient) {}

  /**
   * Handle MembershipStatusChanged event
   *
   * Medusa 고객 그룹(멤버십) 동기화
   */
  async handleMembershipStatusChanged(
    event: MembershipStatusChangedPayload,
  ): Promise<SyncResult> {
    const { userId, email, status } = event;
    const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID;

    if (!membershipGroupId) {
      this.logger.warn('MEDUSA_MEMBERSHIP_GROUP_ID is not set. Skipping sync.');
      return { success: false, data: { userId, action: 'skipped' } };
    }

    if (!email) {
      this.logger.warn(`Missing email for membership sync: ${userId}`);
      return { success: false, data: { userId, action: 'skipped' } };
    }

    try {
      const customer = await this.medusaClient.findCustomerByEmail(email);
      if (!customer) {
        this.logger.warn(
          `Medusa customer not found for email=${email} (userId=${userId})`,
        );
        return { success: false, data: { userId, action: 'skipped' } };
      }

      const addStatuses = new Set(['ACTIVE', 'RESUMED']);
      const removeStatuses = new Set(['PAUSED', 'CANCELLED', 'EXPIRED']);

      if (addStatuses.has(status)) {
        await this.medusaClient.addCustomerToGroup(
          customer.id,
          membershipGroupId,
        );
        return { success: true, data: { userId, action: 'synced' } };
      }

      if (removeStatuses.has(status)) {
        await this.medusaClient.removeCustomerFromGroup(
          customer.id,
          membershipGroupId,
        );
        return { success: true, data: { userId, action: 'synced' } };
      }

      // RECURRING_CANCELLED 등: 그룹 유지 (noop)
      this.logger.log(
        `Membership status ${status} is a no-op for group sync (userId=${userId})`,
      );
      return { success: true, data: { userId, action: 'skipped' } };
    } catch (error) {
      this.logger.error(
        `Failed to sync membership group for userId=${userId}`,
        error.stack,
      );
      return { success: false, data: { userId, action: 'failed' } };
    }
  }
}
