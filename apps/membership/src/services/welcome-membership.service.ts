import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { and, eq } from 'drizzle-orm';
import {
  membershipSchema,
  welcomeMembershipEligibility,
  subscriptionEntitlement,
} from '../shared/schemas/entities/schema';

/**
 * 웰컴 멤버십 구매 자격 서비스
 *
 * 구매 가능 조건 (둘 다 충족해야 함):
 *   1. 활성 멤버십 구독 중 (subscriptionEntitlement.isCurrent = true)
 *   2. 웰컴 멤버십 상품 미구매 (has_purchased = false 또는 행 없음)
 */
@Injectable()
export class WelcomeMembershipService {
  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
  ) {}

  async getEligibility(userId: string): Promise<{
    eligible: boolean;
    reason: string;
    hasPurchased: boolean;
    isActiveMember: boolean;
    purchaseSource: string | null;
    firstOrderId: string | null;
  }> {
    // 1. 활성 멤버십 구독 확인
    const [entitlement] = await this.dbService.db
      .select({ id: subscriptionEntitlement.id })
      .from(subscriptionEntitlement)
      .where(
        and(
          eq(subscriptionEntitlement.userId, userId),
          eq(subscriptionEntitlement.isCurrent, true),
        ),
      )
      .limit(1);

    const isActiveMember = !!entitlement;

    if (!isActiveMember) {
      return {
        eligible: false,
        reason: 'not_a_member',
        hasPurchased: false,
        isActiveMember: false,
        purchaseSource: null,
        firstOrderId: null,
      };
    }

    // 2. 과거 구매 이력 확인
    const [row] = await this.dbService.db
      .select()
      .from(welcomeMembershipEligibility)
      .where(eq(welcomeMembershipEligibility.userId, userId))
      .limit(1);

    if (!row || !row.hasPurchased) {
      return {
        eligible: true,
        reason: 'eligible',
        hasPurchased: false,
        isActiveMember: true,
        purchaseSource: row?.purchaseSource ?? null,
        firstOrderId: row?.firstOrderId ?? null,
      };
    }

    return {
      eligible: false,
      reason: 'already_purchased',
      hasPurchased: true,
      isActiveMember: true,
      purchaseSource: row.purchaseSource,
      firstOrderId: row.firstOrderId,
    };
  }

  /**
   * 웰컴 멤버십 주문 취소 시 구매 이력 되돌리기
   * purchase_source가 'medusa'인 경우에만 되돌림 (cafe24 이력은 유지)
   */
  async revertPurchase(userId: string): Promise<void> {
    await this.dbService.db
      .update(welcomeMembershipEligibility)
      .set({
        hasPurchased: false,
        firstOrderId: null,
        purchasedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(welcomeMembershipEligibility.userId, userId),
          eq(welcomeMembershipEligibility.purchaseSource, 'medusa'),
        ),
      );
  }

  /**
   * 새 시스템(Medusa)에서 웰컴 멤버십 상품 구매 완료 시 호출
   */
  async markPurchased(userId: string, orderId: string): Promise<void> {
    await this.dbService.db
      .insert(welcomeMembershipEligibility)
      .values({
        userId,
        hasPurchased: true,
        purchaseSource: 'medusa',
        firstOrderId: orderId,
        purchasedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: welcomeMembershipEligibility.userId,
        set: {
          hasPurchased: true,
          purchaseSource: 'medusa',
          firstOrderId: orderId,
          purchasedAt: new Date(),
          updatedAt: new Date(),
        },
      });
  }
}
