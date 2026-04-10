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
  ) { }

  /** 그룹 변경 후 카트 가격 재계산 트리거.즉시 리턴됨. */
  private refreshCartPricesAfterGroupChange(customerId: string, userId: string): void {
    this.medusaClient.refreshCustomerCartPrices(customerId);
    this.logger.log(`Cart price refresh triggered (fire-and-forget) for customerId=${customerId}, userId=${userId}`);
  }

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
      let customer = await this.medusaClient.findCustomerByAlmondUserId(userId);

      // almond_user_id로 찾은 고객의 이메일이 멤버십 이메일과 다르면 유령 고객
      // (동일 almond_user_id를 가진 비활성/구버전 고객이 먼저 조회될 수 있음)
      let ghostCustomerId: string | null = null;
      if (customer && customer.email !== email) {
        this.logger.warn(
          `almond_user_id(${userId})로 찾은 고객(${customer.id}, email=${customer.email})이 ` +
          `멤버십 이메일(${email})과 불일치 → 유령 고객으로 판단, email fallback 사용`,
        );
        ghostCustomerId = customer.id;
        customer = null;
      }

      // almond_user_id가 없거나 유령 고객인 경우 email로 fallback 조회
      // 찾은 경우 metadata를 자동 복구하여 이후 조회를 정상화함
      if (!customer) {
        this.logger.warn(
          `almond_user_id(${userId})로 올바른 고객 미발견, email(${email})로 fallback 조회`,
        );
        customer = await this.medusaClient.findCustomerByEmail(email);

        if (customer) {
          this.logger.log(
            `email fallback 성공: customerId=${customer.id} (userId=${userId}). metadata 자동 복구 중...`,
          );
          // 자동 복구: 올바른 고객에 almond_user_id 추가
          this.medusaClient
            .updateCustomerMetadata(customer.id, { almond_user_id: userId })
            .catch((e) =>
              this.logger.warn(`almond_user_id metadata 자동 복구 실패: ${e?.message}`),
            );
          // 유령 고객의 almond_user_id 제거 (중복 조회 방지)
          if (ghostCustomerId) {
            this.medusaClient
              .clearCustomerMetadataKey(ghostCustomerId, 'almond_user_id')
              .catch((e) =>
                this.logger.warn(`유령 고객 almond_user_id 제거 실패 (ghostId=${ghostCustomerId}): ${e?.message}`),
              );
          }
        }
      }

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
        this.refreshCartPricesAfterGroupChange(customer.id, userId);
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
        this.refreshCartPricesAfterGroupChange(customer.id, userId);
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
