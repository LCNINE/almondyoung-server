import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import * as schema from '../../shared/database/schema';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { BnplCmsResponseRepository } from './bnpl-cms-response.repository';
import { PaymentAttemptRepository } from '../payment/payment-attempt.repository';
import { generateUUIDv7 } from '../../shared/utils/id-generator';
import { BnplEvent } from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';

export interface CmsResponseDto {
  status?: 'PROCESSED' | 'FAILED';
  errorCode?: string;
  errorMessage?: string;
  approvalNumber?: string;
  processedAmount?: number;
}

export interface BatchInfo {
  batchId: string;
  totalAmount: number;
  accountCount: number;
  eventCount: number;
}

export interface BatchStatus {
  batchId: string;
  status: string;
  totalAmount: number;
  events: BnplEvent[];
  history: any[];
}

/**
 * BnplSettlementService
 *
 * 책임:
 * - 월말 배치 생성 및 CMS 출금 신청
 * - CMS 출금 결과 처리 (성공/실패)
 * - 실패한 배치 재시도
 * - 배치 상태 조회
 */
@Injectable()
export class BnplSettlementService {
  private readonly logger = new Logger(BnplSettlementService.name);
  private readonly DUE_DATE_OFFSET_DAYS = 5;
  private readonly MAX_RETRY_ATTEMPTS = 3;

  constructor(
    private readonly db: DbService<typeof walletSchema>,
    private readonly cmsResponseRepo: BnplCmsResponseRepository,
    private readonly attemptRepo: PaymentAttemptRepository,
  ) {}

  /**
   * 월말 배치 생성 및 CMS 출금 신청
   * 집계되지 않은 BNPL 이벤트들을 모아서 배치를 생성합니다.
   */
  async createMonthlyBatch(): Promise<BatchInfo> {
    const batchId = `BATCH_${new Date().toISOString().split('T')[0]}_${generateUUIDv7().slice(0, 8)}`;

    return await this.db.db.transaction(async (tx) => {
      // 1. 집계되지 않은 BNPL 이벤트 조회
      const pendingEvents = await tx.query.bnplEvents.findMany({
        where: and(
          eq(schema.bnplEvents.isAggregated, false),
          eq(schema.bnplEvents.status, 'PENDING'),
        ),
      });

      if (pendingEvents.length === 0) {
        throw new Error('No pending events to aggregate');
      }

      // 2. 총액 계산
      const totalAmount = pendingEvents.reduce(
        (sum, event) => sum + event.amount,
        0,
      );

      // 3. 계정별 그룹화
      const accountIds = [...new Set(pendingEvents.map((e) => e.accountId))];

      // 4. 출금 신청일 계산
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + this.DUE_DATE_OFFSET_DAYS);
      const dueDateStr = dueDate.toISOString().split('T')[0];

      // 5. 이벤트 업데이트 (배치 정보 설정)
      await tx
        .update(schema.bnplEvents)
        .set({
          batchTransactionId: batchId,
          batchDueDate: dueDateStr,
          isAggregated: true,
          cmsStatus: 'REQUESTED',
        })
        .where(
          inArray(
            schema.bnplEvents.id,
            pendingEvents.map((e) => e.id),
          ),
        );

      // 6. 각 계정별로 CMS 응답 기록
      for (const accountId of accountIds) {
        const accountEvents = pendingEvents.filter(
          (e) => e.accountId === accountId,
        );
        const accountAmount = accountEvents.reduce(
          (sum, e) => sum + e.amount,
          0,
        );

        await this.cmsResponseRepo.createResponse(
          {
            batchId,
            accountId,
            responseType: 'BATCH_REQUEST_SUBMITTED',
            cmsResponseSnapshot: {
              batchId,
              totalAmount: accountAmount,
              dueDate: dueDateStr,
              eventIds: accountEvents.map((e) => e.id),
              status: 'REQUESTED',
              requestDate: new Date().toISOString(),
            },
            newStatus: 'REQUESTED',
          },
          tx,
        );
      }

      this.logger.log(
        `Monthly batch created: ${batchId}, total: ${totalAmount}, accounts: ${accountIds.length}, events: ${pendingEvents.length}`,
      );

      return {
        batchId,
        totalAmount,
        accountCount: accountIds.length,
        eventCount: pendingEvents.length,
      };
    });
  }

  /**
   * CMS 출금 결과 처리
   * HMS CMS로부터 받은 출금 결과를 처리합니다.
   */
  async processCmsResult(
    batchId: string,
    success: boolean,
    cmsResponse: CmsResponseDto,
  ): Promise<void> {
    await this.db.db.transaction(async (tx) => {
      // 1. 배치에 속한 이벤트 조회
      const events = await tx.query.bnplEvents.findMany({
        where: eq(schema.bnplEvents.batchTransactionId, batchId),
      });

      if (events.length === 0) {
        throw new Error(`No events found for batch: ${batchId}`);
      }

      // 계정 검증 (배치는 단일 계정만 포함해야 함)
      const accountIds = [...new Set(events.map((e) => e.accountId))];
      if (accountIds.length > 1) {
        throw new Error(
          `Batch contains multiple accounts: ${accountIds.join(', ')}`,
        );
      }
      const accountId = accountIds[0];

      if (success) {
        // 성공 처리
        await this.handleCmsSuccess(batchId, events, cmsResponse, tx);
      } else {
        // 실패 처리
        await this.handleCmsFailure(batchId, events, cmsResponse, tx);
      }

      // 2. CMS 응답 기록
      await this.cmsResponseRepo.createResponse(
        {
          batchId,
          accountId,
          responseType: 'BATCH_RESULT_CONFIRMED',
          cmsResponseSnapshot: {
            ...cmsResponse,
            batchId,
            processedDate: new Date().toISOString(),
          },
          previousStatus: 'REQUESTED',
          newStatus: success ? 'PROCESSED' : 'FAILED',
        },
        tx,
      );

      this.logger.log(
        `CMS result processed for batch ${batchId}: ${success ? 'SUCCESS' : 'FAILURE'}`,
      );
    });
  }

  /**
   * CMS 성공 처리
   */
  private async handleCmsSuccess(
    batchId: string,
    events: BnplEvent[],
    _cmsResponse: CmsResponseDto,
    tx: WalletExecutor,
  ): Promise<void> {
    // 1. 이벤트 상태 업데이트
    await tx
      .update(schema.bnplEvents)
      .set({
        cmsStatus: 'PROCESSED',
        status: 'COMPLETED',
      })
      .where(eq(schema.bnplEvents.batchTransactionId, batchId));

    // 2. 관련 payment attempts를 CAPTURED로 업데이트
    const intentIds = events
      .map((e) => e.paymentIntentId)
      .filter((id) => id !== null);

    if (intentIds.length > 0) {
      const attempts = await tx.query.paymentAttempts.findMany({
        where: inArray(schema.paymentAttempts.intentId, intentIds),
      });

      const attemptIds = attempts.map((a) => a.id);

      if (attemptIds.length > 0) {
        await this.attemptRepo.updateStatusBatch(attemptIds, 'CAPTURED', tx);
      }

      // 3. payment intents도 CAPTURED로 업데이트
      await tx
        .update(schema.paymentIntents)
        .set({
          status: 'CAPTURED',
          capturedAt: new Date(),
        })
        .where(inArray(schema.paymentIntents.id, intentIds));
    }

    this.logger.log(`CMS success handled for batch ${batchId}`);
  }

  /**
   * CMS 실패 처리
   */
  private async handleCmsFailure(
    batchId: string,
    events: BnplEvent[],
    cmsResponse: CmsResponseDto,
    tx: WalletExecutor,
  ): Promise<void> {
    // 1. 이벤트 상태 업데이트
    await tx
      .update(schema.bnplEvents)
      .set({
        cmsStatus: 'FAILED',
        cmsErrorCode: cmsResponse.errorCode || 'UNKNOWN_ERROR',
        status: 'FAILED',
      })
      .where(eq(schema.bnplEvents.batchTransactionId, batchId));

    // 2. 관련 payment attempts를 FAILED로 업데이트
    const intentIds = events
      .map((e) => e.paymentIntentId)
      .filter((id) => id !== null);

    if (intentIds.length > 0) {
      const attempts = await tx.query.paymentAttempts.findMany({
        where: inArray(schema.paymentAttempts.intentId, intentIds),
      });

      const attemptIds = attempts.map((a) => a.id);

      if (attemptIds.length > 0) {
        await this.attemptRepo.updateStatusBatch(attemptIds, 'FAILED', tx);
      }

      // 3. payment intents도 FAILED로 업데이트
      await tx
        .update(schema.paymentIntents)
        .set({
          status: 'FAILED',
        })
        .where(inArray(schema.paymentIntents.id, intentIds));
    }

    // 4. 한도 복원 (실패한 경우 사용한 한도를 다시 돌려줌)
    const accountId = events[0].accountId;
    const totalAmount = events.reduce((sum, e) => sum + e.amount, 0);

    await tx
      .update(schema.bnplAccounts)
      .set({
        availableLimit: sql`${schema.bnplAccounts.availableLimit} + ${totalAmount}`,
      })
      .where(eq(schema.bnplAccounts.id, accountId));

    this.logger.log(
      `CMS failure handled for batch ${batchId}, restored ${totalAmount} to account ${accountId}`,
    );
  }

  /**
   * 실패한 배치 재시도
   */
  async retryFailedBatch(originalBatchId: string): Promise<string> {
    return await this.db.db.transaction(async (tx) => {
      // 1. 실패한 이벤트 조회
      const failedEvents = await tx.query.bnplEvents.findMany({
        where: and(
          eq(schema.bnplEvents.batchTransactionId, originalBatchId),
          eq(schema.bnplEvents.cmsStatus, 'FAILED'),
        ),
      });

      if (failedEvents.length === 0) {
        throw new Error('No failed events found for retry');
      }

      // 2. 재시도 횟수 확인
      const history = await this.cmsResponseRepo.findByBatchId(originalBatchId);
      const retryCount = history.filter(
        (h) => h.responseType === 'BATCH_RETRY_ATTEMPTED',
      ).length;

      if (retryCount >= this.MAX_RETRY_ATTEMPTS) {
        throw new Error(
          `Maximum retry attempts (${this.MAX_RETRY_ATTEMPTS}) exceeded`,
        );
      }

      // 3. 새 배치 ID 생성
      const newBatchId = `${originalBatchId}_RETRY_${retryCount + 1}`;
      const totalAmount = failedEvents.reduce((sum, e) => sum + e.amount, 0);

      // 4. 출금 신청일 계산
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + this.DUE_DATE_OFFSET_DAYS);
      const dueDateStr = dueDate.toISOString().split('T')[0];

      // 5. 이벤트 업데이트
      await tx
        .update(schema.bnplEvents)
        .set({
          batchTransactionId: newBatchId,
          batchDueDate: dueDateStr,
          cmsStatus: 'REQUESTED',
          status: 'PENDING',
        })
        .where(
          inArray(
            schema.bnplEvents.id,
            failedEvents.map((e) => e.id),
          ),
        );

      // 6. CMS 재시도 응답 기록
      const accountId = failedEvents[0].accountId;
      await this.cmsResponseRepo.createResponse(
        {
          batchId: newBatchId,
          accountId,
          responseType: 'BATCH_RETRY_ATTEMPTED',
          cmsResponseSnapshot: {
            batchId: newBatchId,
            originalBatchId,
            totalAmount,
            dueDate: dueDateStr,
            retryCount: retryCount + 1,
            eventIds: failedEvents.map((e) => e.id),
            status: 'REQUESTED',
            requestDate: new Date().toISOString(),
          },
          previousStatus: 'FAILED',
          newStatus: 'REQUESTED',
        },
        tx,
      );

      this.logger.log(
        `Batch retry created: ${newBatchId} (retry ${retryCount + 1})`,
      );

      return newBatchId;
    });
  }

  /**
   * 배치 상태 조회
   */
  async getBatchStatus(batchId: string): Promise<BatchStatus> {
    const [events, history] = await Promise.all([
      this.db.db.query.bnplEvents.findMany({
        where: eq(schema.bnplEvents.batchTransactionId, batchId),
      }),
      this.cmsResponseRepo.findByBatchId(batchId),
    ]);

    if (events.length === 0) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    const totalAmount = events.reduce((sum, e) => sum + e.amount, 0);
    const latestHistory = history[0]; // 최신순 정렬되어 있음

    return {
      batchId,
      status: latestHistory?.newStatus || 'UNKNOWN',
      totalAmount,
      events,
      history,
    };
  }
}
