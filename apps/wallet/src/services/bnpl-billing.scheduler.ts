// services/bnpl-billing.scheduler.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DbService } from '@app/db';
import * as schema from '../shared/database/schema';
import { walletSchema } from '../shared/database/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { generateUUIDv7 } from '../shared/utils/id-generator';
import { BnplAccountService } from './bnpl-account.service';
import { HmsApiFactory } from '../shared/utils/hms-api.factory';
import { HmsAPI, MockHmsAPI } from 'hms-api-wrapper';
import {
  CmsWithdrawalRequestSchema,
  type CmsWithdrawalRequestDto,
} from '../shared/zods/cms-withdrawal.zod';
import { PaymentOrchestratorService } from './payment/payment-orchestrator.service';

@Injectable()
export class BnplBillingScheduler {
  private readonly logger = new Logger(BnplBillingScheduler.name);
  private readonly hmsApi: HmsAPI | MockHmsAPI;

  constructor(
    private readonly db: DbService<typeof walletSchema>,
    private readonly bnpl: BnplAccountService,
    private readonly orchestrator: PaymentOrchestratorService,
  ) {
    this.hmsApi = HmsApiFactory.createForBnpl();
  }

  // 출금 신청 (매일 새벽 02:00) — 데모용 단축
  @Cron('0 2 * * *', { name: 'bnpl-cms-billing', timeZone: 'Asia/Seoul' })
  async processBnplBilling() {
    this.logger.log('🏦 BNPL CMS 출금 신청 배치 시작');
    const accounts = await this.bnpl.findAccountsForBilling();
    if (accounts.length === 0) return this.logger.log('📋 대상 없음');

    for (const account of accounts) {
      await this.processSingleAccountBilling(account);
    }
    this.logger.log('✅ 출금 신청 배치 완료');
  }

  // 결과 조회 (매일 오전 10:00) — 데모용 단축
  @Cron('0 10 * * *', { name: 'bnpl-cms-result-check', timeZone: 'Asia/Seoul' })
  async processCmsResultCheck() {
    this.logger.log('🔍 CMS 출금 결과 조회 시작');

    // 신청 완료(대기)인 PURCHASE 이벤트 조회
    const events = await this.db.db.query.bnplEvents.findMany({
      where: and(
        eq(schema.bnplEvents.status, 'AGGREGATED'),
        eq(schema.bnplEvents.eventType, 'PURCHASE'),
      ),
    });
    if (events.length === 0) return this.logger.log('📋 조회 대상 없음');

    // batchTransactionId로 그룹핑
    const groups = new Map<string, typeof events>();
    for (const e of events) {
      if (!e.batchTransactionId) continue;
      if (!groups.has(e.batchTransactionId))
        groups.set(e.batchTransactionId, [] as any);
      (groups.get(e.batchTransactionId) as any).push(e);
    }

    for (const [batchId, list] of groups) {
      await this.checkAndProcessCmsResult(batchId, list);
    }

    this.logger.log('✅ 결과 조회 배치 완료');
  }

  private async processSingleAccountBilling(account: any) {
    const unbilled = await this.bnpl.getUnbilledAmount(account.id);
    if (unbilled <= 0) {
      await this.bnpl.updateNextBillingDate(account.id);
      this.logger.log(`📋 미정산 0원 — skip: ${account.id}`);
      return;
    }

    const batchId = this.generateBatchTransactionId();
    const batchDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    await this.bnpl.markEventsAsAggregated(account.id, batchId, batchDate);

    // CMS 출금 신청
    const dto: CmsWithdrawalRequestDto = {
      transactionId: batchId,
      memberId: account.userId,
      paymentDate: batchDate.replace(/-/g, ''), // YYYYMMDD
      callAmount: unbilled,
    };
    const parsed = CmsWithdrawalRequestSchema.safeParse(dto);
    if (!parsed.success) {
      this.logger.error(
        `❌ CMS 요청 DTO invalid: ${parsed.error.issues[0]?.message}`,
      );
      return;
    }

    const res = await this.callHmsCmsApi(parsed.data);
    await this.bnpl.updateCmsResponse(
      batchId,
      res.success ? 'REQUESTED' : 'FAILED',
      res.payment?.result?.code,
      res.payment,
    );

    // 다음 결제일만 미리 업데이트
    await this.bnpl.updateNextBillingDate(account.id);

    if (res.success) {
      this.logger.log(`✅ CMS 신청 성공: ${batchId}, amount=${unbilled}`);
    } else {
      this.logger.error(
        `❌ CMS 신청 실패: ${batchId}, ${res.payment?.result?.message || 'Unknown'}`,
      );
    }
  }

  private async checkAndProcessCmsResult(batchId: string, events: any[]) {
    const res = await this.checkHmsCmsResult(batchId);

    if (res.payment?.status === 'PROCESSED') {
      await this.processCmsSuccess(batchId, events);
    } else if (res.payment?.status === 'FAILED') {
      await this.processCmsFailure(
        batchId,
        events,
        res.payment?.result?.message || 'FAILED',
      );
    } else {
      this.logger.log(`⏳ 처리중: ${batchId} — 다음 배치에서 재확인`);
    }
  }

  private async processCmsSuccess(batchId: string, events: any[]) {
    await this.db.db.transaction(async (tx) => {
      // 1) 상태 업데이트
      await this.bnpl.updateCmsResponse(
        batchId,
        'PROCESSED',
        undefined,
        undefined,
        tx,
      );

      // 2) 각 이벤트 기준으로 상환/한도복원 + 결제 CAPTURE
      // paymentIntentId 모아 처리
      const intentIds = Array.from(
        new Set(
          events.map((e) => e.paymentIntentId).filter(Boolean) as string[],
        ),
      );

      // 한 계정당 총액을 event.amount로 알 수 있으면 그대로 사용
      for (const e of events) {
        const account = await tx.query.bnplAccounts.findFirst({
          where: eq(schema.bnplAccounts.id, e.accountId),
        });
        if (!account) continue;

        // 구매 이벤트 금액을 상환 처리 (amount는 구매 시 +, 상환 시 -로 기록)
        await this.bnpl.createDebitEvent(
          account.userId,
          e.amount,
          batchId,
          e.aggregationPeriod,
          tx,
        );
      }

      // AUTHORIZED → CAPTURED 전환
      for (const intentId of intentIds) {
        const attempts = await tx.query.paymentAttempts.findMany({
          where: and(
            eq(schema.paymentAttempts.intentId, intentId),
            eq(schema.paymentAttempts.status, 'AUTHORIZED'),
          ),
        });

        for (const attempt of attempts) {
          try {
            await this.orchestrator.capturePayment(
              intentId,
              attempt.id,
              undefined,
              {
                actor: 'BNPL_SCHEDULER',
                source: 'CMS_BATCH_SUCCESS',
              },
            );
          } catch (err: any) {
            // 개별 실패는 로그만
            this.logger.error(
              `CAPTURE 실패: intent=${intentId}, attempt=${attempt.id}, ${err.message}`,
            );
          }
        }
      }
    });

    this.logger.log(`✅ CMS 성공 처리 완료: batch=${batchId}`);
  }

  private async processCmsFailure(batchId: string, events: any[], msg: string) {
    await this.db.db.transaction(async (tx) => {
      await this.bnpl.updateCmsResponse(
        batchId,
        'FAILED',
        undefined,
        undefined,
        tx,
      );

      // 관련 결제 실패로 전환
      const intentIds = Array.from(
        new Set(
          events.map((e) => e.paymentIntentId).filter(Boolean) as string[],
        ),
      );

      if (intentIds.length) {
        await tx
          .update(schema.paymentIntents)
          .set({ status: 'FAILED' })
          .where(inArray(schema.paymentIntents.id, intentIds));

        await tx
          .update(schema.paymentAttempts)
          .set({ status: 'FAILED' })
          .where(inArray(schema.paymentAttempts.intentId, intentIds));
      }

      // 이벤트들도 실패 표시
      await this.bnpl.failEventsByBatch(batchId, tx);
    });

    this.logger.warn(`❌ CMS 실패 처리 완료: batch=${batchId}, err=${msg}`);
  }

  private generateBatchTransactionId(): string {
    // YYYYMMDD + uuidv7 하위 6자리 → 30자 제한 안전
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const tail = generateUUIDv7().slice(-6).toUpperCase();
    return `${d}${tail}`;
  }

  private async callHmsCmsApi(
    payload: CmsWithdrawalRequestDto,
  ): Promise<{ success: boolean; payment?: any }> {
    try {
      const resp = await this.hmsApi.withdrawals.request(payload);
      return {
        success: resp.payment.result.flag === 'Y',
        payment: resp.payment,
      };
    } catch (e: any) {
      return {
        success: false,
        payment: {
          result: { flag: 'N', code: 'API_ERROR', message: e.message },
        },
      };
    }
  }

  private async checkHmsCmsResult(
    batchId: string,
  ): Promise<{ success: boolean; payment?: any }> {
    try {
      const resp = await this.hmsApi.withdrawals.get(batchId);
      return {
        success: resp.payment.result.flag === 'Y',
        payment: resp.payment,
      };
    } catch (e: any) {
      return {
        success: false,
        payment: {
          result: { flag: 'N', code: 'INQUIRY_ERROR', message: e.message },
          status: 'FAILED',
        },
      };
    }
  }
}
