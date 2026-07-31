import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from '@app/db';
import { desc, eq, inArray } from 'drizzle-orm';
import { format, subDays } from 'date-fns';
import * as schema from '../../shared/schemas/entities/schema';
import { membershipSchema } from '../../shared/schemas/entities/schema';
import { PaymentClientService } from '../billing/payment-client.service';
import { ContractEventManager } from './contract-event.manager';

/** 한 번에 처리할 최대 건수. 남은 건은 다음 실행이 이어받는다(스케줄러가 오래 물고 있지 않게). */
const BATCH_SIZE = 50;
/** 이 기간이 지나도 정리되지 않으면 사람이 봐야 한다(무한 재시도로 조용히 묻히지 않게). */
const ESCALATE_AFTER_DAYS = 7;

/**
 * 자동이체 약정 정리 재시도.
 *
 * 해지 시 wallet 약정 종료가 실패하면 `AGREEMENT_REVOKE_PENDING` 계약 이벤트만 남는다. 재청구는
 * DB 플래그(autoRenewal=false + nextBillingDate=null)로 이미 막혀 있어 급하진 않지만, **효성 CMS 약정은
 * 은행에 그대로 살아있다** — 방치하면 해지한 고객의 계좌에 자동이체 등록이 남는다(민원·재출금 위험).
 * 사람이 로그를 뒤져 발견하는 대신 스케줄러가 이어서 끝낸다.
 *
 * 재시도 성공/실패는 계약 이벤트로 확정한다. PENDING 이벤트보다 최신 종료/실패 이벤트가 있으면
 * 그 계약은 대상에서 빠지므로, 별도 상태 컬럼(=스키마 변경) 없이 큐가 스스로 비워진다.
 */
@Injectable()
export class AgreementCleanupService {
  private readonly logger = new Logger(AgreementCleanupService.name);

  constructor(
    private readonly dbService: DbService<typeof membershipSchema>,
    private readonly paymentClientService: PaymentClientService,
    private readonly contractEventManager: ContractEventManager,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async retryPendingAgreementRevokes(): Promise<void> {
    const pending = await this.findPending();
    if (pending.length === 0) return;

    this.logger.log(`자동이체 약정 정리 재시도 대상 ${pending.length}건`);
    for (const item of pending) {
      await this.retryOne(item);
    }
  }

  /**
   * 아직 정리되지 않은 계약.
   *
   * 계약별 최신 약정 관련 이벤트가 `AGREEMENT_REVOKE_PENDING` 인 건만 고른다 —
   * 그 뒤에 성공(REVOKED)/포기(ABANDONED) 이벤트가 붙으면 자연히 목록에서 빠진다.
   */
  private async findPending(): Promise<{ contractId: string; userId: string; pendingSince: Date }[]> {
    const latest = this.dbService.db
      .selectDistinctOn([schema.subscriptionContractEvents.contractId], {
        contractId: schema.subscriptionContractEvents.contractId,
        userId: schema.subscriptionContractEvents.userId,
        eventType: schema.subscriptionContractEvents.eventType,
        metadata: schema.subscriptionContractEvents.metadata,
        createdAt: schema.subscriptionContractEvents.createdAt,
      })
      .from(schema.subscriptionContractEvents)
      .where(
        inArray(schema.subscriptionContractEvents.eventType, [
          'AGREEMENT_REVOKE_PENDING',
          'AGREEMENT_REVOKE_DEFERRED',
          'AGREEMENT_REVOKED',
          'AGREEMENT_REVOKE_ABANDONED',
        ]),
      )
      .orderBy(
        schema.subscriptionContractEvents.contractId,
        desc(schema.subscriptionContractEvents.createdAt),
        desc(schema.subscriptionContractEvents.id),
      )
      .as('latest');

    const rows = await this.dbService.db
      .select({
        contractId: latest.contractId,
        userId: latest.userId,
        eventType: latest.eventType,
        metadata: latest.metadata,
        pendingSince: latest.createdAt,
      })
      .from(latest)
      .where(inArray(latest.eventType, ['AGREEMENT_REVOKE_PENDING', 'AGREEMENT_REVOKE_DEFERRED']))
      .orderBy(latest.createdAt)
      .limit(BATCH_SIZE);

    const today = format(new Date(), 'yyyy-MM-dd');
    // 보류(DEFERRED) 건은 이용 기간이 끝나기 전에 지우면 남은 수금이 실패해 무료 이용이 된다.
    // 종료일이 지난 뒤에야 정리 대상이 된다.
    return rows
      .filter((r) => {
        if (r.eventType !== 'AGREEMENT_REVOKE_DEFERRED') return true;
        const notBefore = ((r.metadata ?? {}) as { notBefore?: string }).notBefore;
        return !notBefore || notBefore < today;
      })
      .map((r) => ({
        contractId: r.contractId,
        userId: r.userId,
        // 포기(ABANDONED) 시계는 '재시도가 가능해진 시점'부터 센다. 보류 기록 시각부터 세면
        // 이용 기간이 긴 계약은 첫 재시도 실패에 곧바로 포기 처리된다.
        pendingSince: this.retryableSince(r.pendingSince, r.metadata),
      }));
  }

  private retryableSince(createdAt: Date, metadata: unknown): Date {
    const notBefore = ((metadata ?? {}) as { notBefore?: string }).notBefore;
    if (!notBefore) return createdAt;
    const eligibleAt = new Date(`${notBefore}T00:00:00`);
    return Number.isNaN(eligibleAt.getTime()) || eligibleAt < createdAt ? createdAt : eligibleAt;
  }

  private async retryOne(item: { contractId: string; userId: string; pendingSince: Date }): Promise<void> {
    try {
      const result = await this.paymentClientService.terminateBillingMandate(item.contractId);

      // 약정이 없거나(이미 정리됨) 종료됐으면 끝. 결제수단이 다른 활성 구독과 공유돼 건너뛴 경우도
      // 정상 종료다 — 남은 구독이 그 수단을 계속 써야 하므로 더 할 일이 없다.
      const done =
        !result.agreementFound ||
        result.mandateTerminated ||
        result.skipReason === 'BILLING_METHOD_IN_USE_BY_OTHER_AGREEMENT';

      if (done) {
        await this.record(item, 'AGREEMENT_REVOKED', {
          agreementFound: result.agreementFound,
          mandateTerminated: result.mandateTerminated,
          cancelledWithdrawals: result.cancelledWithdrawals,
          skipReason: result.skipReason ?? null,
        });
        this.logger.log(`자동이체 약정 정리 완료 (contractId=${item.contractId})`);
        return;
      }

      await this.escalateIfStale(item, result.skipReason ?? 'UNKNOWN');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`자동이체 약정 정리 재시도 실패 (contractId=${item.contractId}): ${message}`);
      await this.escalateIfStale(item, message);
    }
  }

  /**
   * 오래된 건은 재시도를 멈추고 사람이 처리할 대상으로 확정한다.
   *
   * 효성 삭제 가드처럼 재시도로 풀리지 않는 실패가 있어서, 계속 두면 매시간 같은 실패만 반복하며
   * 로그를 채우고 실제로는 아무도 처리하지 않는다.
   */
  private async escalateIfStale(
    item: { contractId: string; userId: string; pendingSince: Date },
    reason: string,
  ): Promise<void> {
    if (item.pendingSince > subDays(new Date(), ESCALATE_AFTER_DAYS)) return;

    await this.record(item, 'AGREEMENT_REVOKE_ABANDONED', { reason, pendingSince: item.pendingSince.toISOString() });
    this.logger.error(
      `자동이체 약정 정리 ${ESCALATE_AFTER_DAYS}일 경과 — 수동 처리 필요 (contractId=${item.contractId}, reason=${reason})`,
    );
  }

  private async record(
    item: { contractId: string; userId: string },
    eventType: 'AGREEMENT_REVOKED' | 'AGREEMENT_REVOKE_ABANDONED',
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.dbService.db.transaction(async (tx) => {
      await this.contractEventManager.addEvent(tx, item.contractId, eventType, metadata, 'SYSTEM', item.userId);
    });
  }
}
