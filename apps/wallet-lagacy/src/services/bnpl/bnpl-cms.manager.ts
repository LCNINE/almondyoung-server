import { Injectable, Logger } from '@nestjs/common';
import * as schema from '../../shared/database/schema';
import { eq, inArray } from 'drizzle-orm';
import { PaymentAttemptRepository } from '../payment/payment-attempt.repository';
import type { BnplEvent } from '../../shared/database/types';
import type { WalletExecutor } from '../../shared/database';
import { BnplRepository } from './bnpl.repository';

export interface CmsResponseDto {
  status?: 'PROCESSED' | 'FAILED';
  errorCode?: string;
  errorMessage?: string;
  approvalNumber?: string;
  processedAmount?: number;
}

/**
 * BnplCmsManager - CMS 결과 처리 (Implementation Layer)
 */
@Injectable()
export class BnplCmsManager {
  private readonly logger = new Logger(BnplCmsManager.name);

  constructor(
    private readonly repo: BnplRepository,
    private readonly attemptRepo: PaymentAttemptRepository,
  ) {}

  async processSuccess(
    batchId: string,
    events: BnplEvent[],
    _cmsResponse: CmsResponseDto,
    tx: WalletExecutor,
  ): Promise<void> {
    // 1. 이벤트 상태 업데이트
    await this.repo.updateEventsByBatchId(
      batchId,
      {
        cmsStatus: 'PROCESSED',
        status: 'COMPLETED',
      },
      tx,
    );

    // 2. 관련 payment attempts를 CAPTURED로 업데이트
    const intentIds = events
      .map((e: BnplEvent) => e.paymentIntentId)
      .filter((id: string | null) => id !== null);

    if (intentIds.length > 0) {
      const attempts = await tx.query.paymentAttempts.findMany({
        where: inArray(schema.paymentAttempts.intentId, intentIds),
      });

      const attemptIds = attempts.map((a: any) => a.id);

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

    this.logger.log(`CMS success processed for batch ${batchId}`);
  }

  async processFailure(
    batchId: string,
    events: BnplEvent[],
    cmsResponse: CmsResponseDto,
    tx: WalletExecutor,
  ): Promise<void> {
    // 1. 이벤트 상태 업데이트
    await this.repo.updateEventsByBatchId(
      batchId,
      {
        cmsStatus: 'FAILED',
        cmsErrorCode: cmsResponse.errorCode || 'UNKNOWN_ERROR',
        status: 'FAILED',
      },
      tx,
    );

    // 2. 관련 payment attempts를 FAILED로 업데이트
    const intentIds = events
      .map((e: BnplEvent) => e.paymentIntentId)
      .filter((id: string | null) => id !== null);

    if (intentIds.length > 0) {
      const attempts = await tx.query.paymentAttempts.findMany({
        where: inArray(schema.paymentAttempts.intentId, intentIds),
      });

      const attemptIds = attempts.map((a: any) => a.id);

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
    await this.restoreCreditLimit(events, tx);

    this.logger.log(`CMS failure processed for batch ${batchId}`);
  }

  async recordResponse(
    batchId: string,
    accountId: string,
    success: boolean,
    cmsResponse: CmsResponseDto,
    tx: WalletExecutor,
  ): Promise<void> {
    await this.repo.createCmsResponse(
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
  }

  private async restoreCreditLimit(
    events: BnplEvent[],
    tx: WalletExecutor,
  ): Promise<void> {
    const accountId = events[0].accountId;
    const totalAmount = events.reduce(
      (sum: number, e: BnplEvent) => sum + e.amount,
      0,
    );

    // 현재 계정 조회
    const account = await this.repo.findAccountById(accountId, tx);

    if (!account) {
      throw new Error(`Account not found: ${accountId}`);
    }

    await this.repo.updateAccount(
      accountId,
      { availableLimit: account.availableLimit + totalAmount },
      tx,
    );

    this.logger.log(
      `Restored ${totalAmount} to account ${accountId} credit limit`,
    );
  }
}
