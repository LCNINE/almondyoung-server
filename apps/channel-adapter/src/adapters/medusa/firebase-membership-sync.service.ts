import { Injectable, Logger } from '@nestjs/common';
import { MedusaClient } from './medusa.client';
import { UserServiceClient } from '../../services/user-service.client';

@Injectable()
export class FirebaseMembershipSyncService {
  private readonly logger = new Logger(FirebaseMembershipSyncService.name);

  constructor(
    private readonly medusaClient: MedusaClient,
    private readonly userServiceClient: UserServiceClient,
  ) {}

  /**
   * Firebase 멤버십 상태를 Medusa 고객 그룹에 동기화
   *
   * @param cafe24MemberId - Cafe24 회원 ID (almond-auth: connectedServices.almondYoung.id)
   * @param active - 멤버십 활성 여부
   * @param email - user-service email (없으면 user-service에서 조회)
   */
  async syncByFirebase(
    cafe24MemberId: string,
    active: boolean,
    email?: string,
  ): Promise<void> {
    const membershipGroupId = process.env.MEDUSA_MEMBERSHIP_GROUP_ID;

    if (!membershipGroupId) {
      this.logger.warn('MEDUSA_MEMBERSHIP_GROUP_ID가 설정되지 않았습니다. 동기화를 건너뜁니다.');
      return;
    }

    // email이 없으면 user-service에서 조회
    let resolvedEmail = email;
    if (!resolvedEmail) {
      const linkInfo = await this.userServiceClient.getLinkInfo(cafe24MemberId);
      if (!linkInfo) {
        this.logger.log(
          `user-service에 cafe24MemberId=${cafe24MemberId} 연동 정보 없음. Medusa 동기화 건너뜁니다.`,
        );
        return;
      }
      resolvedEmail = linkInfo.email;
    }

    const customer = await this.medusaClient.findCustomerByEmail(resolvedEmail);
    if (!customer) {
      this.logger.log(
        `Medusa 고객 없음 (email=${resolvedEmail}, cafe24MemberId=${cafe24MemberId}). 건너뜁니다.`,
      );
      return;
    }

    try {
      if (active) {
        await this.medusaClient.addCustomerToGroup(customer.id, membershipGroupId);
        this.logger.log(
          `멤버십 그룹 추가: customerId=${customer.id}, cafe24MemberId=${cafe24MemberId}`,
        );
      } else {
        await this.medusaClient.removeCustomerFromGroup(customer.id, membershipGroupId);
        this.logger.log(
          `멤버십 그룹 제거: customerId=${customer.id}, cafe24MemberId=${cafe24MemberId}`,
        );
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
