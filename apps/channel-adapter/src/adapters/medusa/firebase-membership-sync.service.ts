import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { MedusaClient } from './medusa.client';
import { EventTrackingService } from '@app/events';
import { cafe24MemberMappings } from '../../schema';
import type { ChannelAdapterSchema } from '../../types';

@Injectable()
export class FirebaseMembershipSyncService {
  private readonly logger = new Logger(FirebaseMembershipSyncService.name);

  constructor(
    private readonly medusaClient: MedusaClient,
    private readonly dbService: DbService<ChannelAdapterSchema>,
    private readonly eventTrackingService: EventTrackingService,
  ) {}

  /**
   * Firebase 멤버십 상태를 Medusa 고객 그룹에 동기화
   *
   * @param cafe24MemberId - Cafe24 회원 ID
   * @param active - 멤버십 활성 여부
   */
  async syncByFirebase(cafe24MemberId: string, active: boolean): Promise<void> {
    const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID;

    if (!membershipGroupId) {
      this.logger.warn('MEDUSA_MEMBERSHIP_GROUP_ID가 설정되지 않았습니다. 동기화를 건너뜁니다.');
      return;
    }

    const [mapping] = await this.dbService.db
      .select()
      .from(cafe24MemberMappings)
      .where(eq(cafe24MemberMappings.cafe24MemberId, cafe24MemberId))
      .limit(1);

    if (!mapping) {
      this.logger.log(`cafe24MemberId=${cafe24MemberId} 매핑 없음. Medusa 동기화 건너뜁니다.`);
      await this.eventTrackingService
        .trackEffect({
          resourceType: 'FirebaseMembership',
          resourceId: cafe24MemberId,
          action: 'SKIPPED',
          description: 'cafe24_member_mappings 매핑 없음',
          eventType: 'FirebaseMembershipSync',
        })
        .catch((e) => this.logger.warn(`trackEffect 실패: ${e?.message}`));
      return;
    }

    const almondUserId = mapping.userId;

    const customer = await this.medusaClient.findCustomerByAlmondUserId(almondUserId);
    if (!customer) {
      this.logger.log(`Medusa 고객 없음 (almondUserId=${almondUserId}, cafe24MemberId=${cafe24MemberId}). 건너뜁니다.`);
      await this.eventTrackingService
        .trackEffect({
          resourceType: 'FirebaseMembership',
          resourceId: cafe24MemberId,
          action: 'SKIPPED',
          description: `Medusa 고객 없음 (almondUserId=${almondUserId})`,
          eventType: 'FirebaseMembershipSync',
        })
        .catch((e) => this.logger.warn(`trackEffect 실패: ${e?.message}`));
      return;
    }

    try {
      if (active) {
        await this.medusaClient.addCustomerToGroup(customer.id, membershipGroupId);
        this.medusaClient.refreshCustomerCartPrices(customer.id);
        this.logger.log(`멤버십 그룹 추가 + 카트 갱신 트리거: customerId=${customer.id}, cafe24MemberId=${cafe24MemberId}`);
        await this.eventTrackingService
          .trackEffect({
            resourceType: 'MedusaCustomer',
            resourceId: customer.id,
            action: 'SYNCED',
            description: `멤버십 그룹 추가 (cafe24MemberId=${cafe24MemberId})`,
            eventType: 'FirebaseMembershipSync',
          })
          .catch((e) => this.logger.warn(`trackEffect 실패: ${e?.message}`));
      } else {
        await this.medusaClient.removeCustomerFromGroup(customer.id, membershipGroupId);
        this.medusaClient.refreshCustomerCartPrices(customer.id);
        this.logger.log(`멤버십 그룹 제거 + 카트 갱신 트리거: customerId=${customer.id}, cafe24MemberId=${cafe24MemberId}`);
        await this.eventTrackingService
          .trackEffect({
            resourceType: 'MedusaCustomer',
            resourceId: customer.id,
            action: 'SYNCED',
            description: `멤버십 그룹 제거 (cafe24MemberId=${cafe24MemberId})`,
            eventType: 'FirebaseMembershipSync',
          })
          .catch((e) => this.logger.warn(`trackEffect 실패: ${e?.message}`));
      }
    } catch (error) {
      this.logger.error(
        `Medusa 고객 그룹 동기화 실패 (cafe24MemberId=${cafe24MemberId}): ${error?.message}`,
        error?.stack,
      );
      throw error;
    }
  }
}
