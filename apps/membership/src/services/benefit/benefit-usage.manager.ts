import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { EntitlementReader } from '../entitlement/entitlement.reader';
import { SubscriptionContractReader } from '../subscription/subscription-contract.reader';
import { CancellationContextReader } from '../subscription/cancellation-context.reader';
import { isWithdrawalEligible, withdrawalDaysRemaining } from '../subscription/refund-policy.service';
import { BenefitReader } from './benefit.reader';
import { BenefitUsageKind } from './benefit-usage';

/**
 * - NOT_MEMBER: 지금 멤버십이 아니다. 기록하지 않고, 혜택도 열면 안 된다.
 * - CONFIRMATION_REQUIRED: 청약철회로 전액 환불받을 수 있는 주기다. 열면 그 권리를 잃으므로 고객 동의 없이는 기록하지 않는다.
 * - RECORDED / ALREADY_RECORDED: 열어도 된다.
 */
export type BenefitUsageStatus = 'NOT_MEMBER' | 'CONFIRMATION_REQUIRED' | 'RECORDED' | 'ALREADY_RECORDED';

export type BenefitUsageResult = { status: BenefitUsageStatus; withdrawalDaysRemaining?: number };

@Injectable()
export class BenefitUsageManager {
  constructor(
    private readonly db: DbService<typeof membershipSchema>,
    private readonly entitlementReader: EntitlementReader,
    private readonly contractReader: SubscriptionContractReader,
    private readonly cancellationContextReader: CancellationContextReader,
    private readonly benefitReader: BenefitReader,
  ) {}

  /**
   * 혜택을 열기 직전에 부른다 — 기록이 혜택을 여는 조건이라, 기록 없이 열리는 길이 없어야 한다.
   *
   * 주기 시작은 해지 화면과 같은 계산(`resolvePaidPeriodStart`)을 쓴다. 다르게 세면 «이번 주기에 썼다»는
   * 기록이 환불 판정이 보는 주기 밖에 떨어진다.
   */
  async recordUsage(userId: string, kind: BenefitUsageKind, acknowledged: boolean): Promise<BenefitUsageResult> {
    const [activeUserIds, entitlement, contractWithPlan] = await Promise.all([
      this.entitlementReader.getActiveUserIds([userId]),
      this.contractReader.findCurrentEntitlement(userId),
      this.contractReader.findContractWithPlan(userId),
    ]);
    if (!activeUserIds.includes(userId) || !entitlement) return { status: 'NOT_MEMBER' };

    const paidPeriodStart = contractWithPlan
      ? await this.cancellationContextReader.resolvePaidPeriodStart(
          contractWithPlan.contract,
          contractWithPlan.plan,
          entitlement,
        )
      : null;
    // 결제가 없는 이용권(관리자 부여)은 철회 창이 없다 — 멱등 키로만 자격 개시일을 쓴다.
    const periodStart = paidPeriodStart ?? new Date(entitlement.startsAt);

    if (await this.benefitReader.hasBenefitUsageSince(userId, kind, periodStart)) return { status: 'ALREADY_RECORDED' };

    if (!acknowledged && paidPeriodStart) {
      const usage = await this.benefitReader.findMembershipBenefitUsageSince(userId, paidPeriodStart);
      const now = new Date();
      if (isWithdrawalEligible({ periodStart: paidPeriodStart, now, usage })) {
        return { status: 'CONFIRMATION_REQUIRED', withdrawalDaysRemaining: withdrawalDaysRemaining(paidPeriodStart, now) };
      }
    }

    const inserted = await this.db.db
      .insert(schema.membershipBenefitUsages)
      .values({ userId, kind, contractId: contractWithPlan?.contract.id ?? null, periodStart })
      .onConflictDoNothing()
      .returning({ id: schema.membershipBenefitUsages.id });
    return { status: inserted.length > 0 ? 'RECORDED' : 'ALREADY_RECORDED' };
  }
}
